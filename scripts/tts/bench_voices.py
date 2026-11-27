#!/usr/bin/env python3
"""
Banco de vozes pt-BR — MESMO roteiro, quatro interpretações de campanha, todas as vozes locais e o
baseline atual (Windows SAPI "Maria"). Mede o que dá para medir; a naturalidade é julgada OUVINDO.

  python bench_voices.py <modelDir> <outDir>

Métricas por amostra:
- geração (ms), fator de tempo real, pico de RAM do processo;
- inteligibilidade: transcrição do Whisper (faster-whisper small, pt) × texto → WER;
- entonação: desvio do F0 em semitons (voz "monótona" ≈ < 1,5 st) e faixa p10–p90;
- ritmo: sílabas/s na fala, pausas detectadas.
"""
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from tts_runner import rss_mb, synth_kokoro, synth_piper, trim  # noqa: E402

# Roteiros escritos PARA FALA (frases curtas, pausas marcadas) e já normalizados (siglas/números por extenso).
CAMPAIGNS = {
    "moda": {"profile": {"speed": 0.95, "expressiveness": 0.7, "pause": 420}, "lines": [
        "Olha esse traço.", "Você reconhece?", "A ou B... pensa rápido.", "Era a A.", "A estampa Fé, da cê eme cá vê.", "Conta aqui embaixo: você acertou?"]},
    "tecnologia": {"profile": {"speed": 1.05, "expressiveness": 0.5, "pause": 260}, "lines": [
        "Mudou o atendente.", "E o contexto?", "Na Vórix, a nota interna acompanha a conversa.", "Ninguém precisa perguntar tudo de novo."]},
    "casamento": {"profile": {"speed": 0.9, "expressiveness": 0.75, "pause": 520}, "lines": [
        "Vai casar?", "Seu site de casamento começa aqui.", "Lista de presentes com Pix direto para os noivos.", "Sem comissão."]},
    "ofertas": {"profile": {"speed": 1.12, "expressiveness": 0.65, "pause": 200}, "lines": [
        "Ainda pesquisa loja por loja?", "Mesmo produto, vários preços.", "No Preço Baixo Club, você compara num lugar só.", "E vai direto para a melhor oferta."]},
}
VOICES = [("piper", "pt_BR-faber-medium"), ("piper", "pt_BR-cadu-medium"), ("piper", "pt_BR-jeff-medium"), ("piper", "pt_BR-edresson-low"),
          ("kokoro", "pf_dora"), ("kokoro", "pm_alex"), ("kokoro", "pm_santa"), ("sapi", "Microsoft Maria Desktop")]


def write_wav(path, signal, rate):
    peak = float(np.max(np.abs(signal))) or 1.0
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes((np.clip(signal * 0.89 / peak, -1, 1) * 32767).astype(np.int16).tobytes())


def read_wav(path):
    with wave.open(path, "rb") as w:
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        if w.getnchannels() == 2:
            data = data.reshape(-1, 2).mean(axis=1)
    return data, rate


def sapi(voice, lines, profile, out):
    text = " ".join(lines).replace("'", "''")
    rate = round((profile["speed"] - 1) * 10)
    ps = f"Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; try {{ $s.SelectVoice('{voice}') }} catch {{}}; $s.Rate = {rate}; $s.SetOutputToWaveFile('{out}'); $s.Speak('{text}'); $s.Dispose()"
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)


def pitch_stats(x, rate):
    """F0 por autocorrelação (quadros de 40 ms, passo 10 ms), só em quadros com voz."""
    hop, win = int(rate * 0.01), int(rate * 0.04)
    f0 = []
    energy_floor = np.percentile(np.abs(x), 60) * 1.5 + 1e-4
    for i in range(0, len(x) - win, hop):
        frame = x[i:i + win] - np.mean(x[i:i + win])
        if np.sqrt(np.mean(frame ** 2)) < energy_floor:
            continue
        ac = np.correlate(frame, frame, "full")[win - 1:]
        lo, hi = int(rate / 400), int(rate / 70)
        if hi >= len(ac):
            continue
        lag = lo + int(np.argmax(ac[lo:hi]))
        if ac[lag] / (ac[0] + 1e-9) > 0.45:
            f0.append(rate / lag)
    if len(f0) < 10:
        return None
    st = 12 * np.log2(np.array(f0) / np.median(f0))
    return {"f0Median": round(float(np.median(f0)), 1), "stdSemitones": round(float(np.std(st)), 2), "rangeSemitones": round(float(np.percentile(st, 90) - np.percentile(st, 10)), 2)}


def pauses(x, rate):
    env = np.convolve(np.abs(x), np.ones(int(rate * 0.02)) / int(rate * 0.02), mode="same")
    silent = env < 0.01
    runs, count = [], 0
    for s in silent:
        if s:
            count += 1
        else:
            if count > rate * 0.12:
                runs.append(count / rate)
            count = 0
    return runs


def norm_words(text):
    t = unicodedata.normalize("NFD", text.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.findall(r"[a-z0-9]+", t)


def wer(ref, hyp):
    r, h = norm_words(ref), norm_words(hyp)
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int)
    d[:, 0] = range(len(r) + 1); d[0, :] = range(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return round(d[-1, -1] / max(1, len(r)), 3)


def main():
    model_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    results = []
    for engine, voice in VOICES:
        for name, camp in CAMPAIGNS.items():
            p = camp["profile"]
            segments = [{"text": line, "speed": p["speed"], "expressiveness": p["expressiveness"], "pauseAfterMs": p["pause"]} for line in camp["lines"]]
            short = voice.replace("pt_BR-", "").replace("Microsoft ", "").replace(" Desktop", "").replace(" ", "")
            path = os.path.join(out_dir, f"{name}__{engine}-{short}.wav")
            t0 = time.time()
            if engine == "sapi":
                sapi(voice, camp["lines"], p, path)
            else:
                parts, rate = (synth_piper if engine == "piper" else synth_kokoro)(model_dir, voice, segments)
                chunks = []
                for seg, audio in zip(segments, parts):
                    chunks += [trim(audio, rate), np.zeros(int(rate * seg["pauseAfterMs"] / 1000), np.float32)]
                write_wav(path, np.concatenate(chunks), rate)
            ms = int((time.time() - t0) * 1000)
            x, rate = read_wav(path)
            dur = len(x) / rate
            speech = dur - sum(pauses(x, rate))
            text = " ".join(camp["lines"])
            results.append({"campaign": name, "engine": engine, "voice": voice, "file": os.path.basename(path), "generationMs": ms, "durationSeconds": round(dur, 2), "rtf": round(ms / 1000 / dur, 3), "peakRssMb": round(rss_mb(), 1),
                            "syllablesPerSecond": round(sum(len(re.findall(r"[aeiouáéíóúâêôãõà]+", w)) for w in text.lower().split()) / max(0.1, speech), 2),
                            "pauses": len(pauses(x, rate)), "pitch": pitch_stats(x, rate)})
            print(f"{name:11s} {engine:6s} {voice:24s} {ms:6d} ms  {dur:5.2f} s  pitch {results[-1]['pitch']}", flush=True)
    # Inteligibilidade (pronúncia): o Whisper transcreve e compara com o texto.
    from faster_whisper import WhisperModel
    asr = WhisperModel("small", device="cpu", compute_type="int8")
    for r in results:
        segments, _ = asr.transcribe(os.path.join(out_dir, r["file"]), language="pt", beam_size=5)
        hyp = " ".join(s.text for s in segments).strip()
        r["transcript"] = hyp
        r["wer"] = wer(" ".join(CAMPAIGNS[r["campaign"]]["lines"]), hyp)
    with open(os.path.join(out_dir, "metricas.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("ok")


if __name__ == "__main__":
    main()
