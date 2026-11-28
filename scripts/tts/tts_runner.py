#!/usr/bin/env python3
"""
Narração LOCAL (sem API paga) para o motor de vídeo — processo separado, chamado pelo worker.

Entrada (JSON no stdin):
  { "engine": "piper" | "kokoro", "voice": "pt_BR-faber-medium" | "pf_dora", "modelDir": "...",
    "output": "narracao.wav", "segments": [ { "text": "...", "pauseAfterMs": 300, "speed": 1.0,
    "expressiveness": 0.6 } ] }
Saída (JSON no stdout): { "sampleRate", "durationSeconds", "segments": [ { "start", "end", "words": [...] } ],
    "generationMs", "peakRssMb" }

- Pausas: cada trecho é sintetizado separado e o silêncio entre eles é EXATO (a interpretação respira
  onde o roteiro manda, não onde o modelo acha).
- Velocidade por trecho (ênfase = trecho mais lento); expressividade no Piper = noise_scale.
- Palavras com início/fim estimados (Piper: alinhamento de fonemas; Kokoro: proporcional às sílabas) —
  usados para sincronizar tipografia e cortes com a fala.

Licenças: Piper (GPL-3.0, processo separado; vozes pt_BR faber/cadu/jeff com dataset CC0); Kokoro-82M
(pesos Apache-2.0); espeak-ng (GPL-3.0, fonemização, processo separado).
"""
import json
import os
import re
import sys
import time
import wave

import numpy as np


def rss_mb():
    try:
        import psutil
        return psutil.Process(os.getpid()).memory_info().rss / 1048576
    except Exception:  # noqa: BLE001 — métrica opcional
        return 0.0


def syllables(word: str) -> int:
    return max(1, len(re.findall(r"[aeiouáéíóúâêôãõà]+", word.lower())))


def estimate_words(text: str, start: float, end: float):
    """Tempos por palavra proporcionais às sílabas (usado quando o motor não devolve alinhamento)."""
    words = [w for w in re.split(r"\s+", text.strip()) if w]
    weights = [syllables(w) + 0.3 for w in words]
    total = sum(weights) or 1
    out, t = [], start
    for w, k in zip(words, weights):
        d = (end - start) * k / total
        out.append({"word": w, "start": round(t, 3), "end": round(t + d, 3)})
        t += d
    return out


def synth_piper(model_dir, voice, segments):
    from piper import PiperVoice, SynthesisConfig
    v = PiperVoice.load(os.path.join(model_dir, f"{voice}.onnx"))
    rate = v.config.sample_rate
    parts = []
    for seg in segments:
        cfg = SynthesisConfig(length_scale=1.0 / max(0.6, min(1.6, seg.get("speed", 1.0))), noise_scale=0.35 + 0.5 * seg.get("expressiveness", 0.5), noise_w_scale=0.5 + 0.4 * seg.get("expressiveness", 0.5))
        # Piper: frases do bloco saem juntas, com o respiro pedido entre elas (não o silêncio padrão do modelo).
        if seg.get("sentencePause") is not None:
            pieces = []
            for chunk in v.synthesize(seg["text"], syn_config=cfg):
                pieces += [chunk.audio_float_array.astype(np.float32), np.zeros(int(rate * seg["sentencePause"]), np.float32)]
            parts.append(np.concatenate(pieces[:-1]) if pieces else np.zeros(1, np.float32))
            continue
        audio = [np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16).astype(np.float32) / 32768 for chunk in v.synthesize(seg["text"], syn_config=cfg)]
        parts.append(np.concatenate(audio) if audio else np.zeros(1, np.float32))
    return parts, rate


_kokoro = {}


def synth_kokoro(model_dir, voice, segments):
    from kokoro_onnx import Kokoro
    if "k" not in _kokoro:
        _kokoro["k"] = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
    k = _kokoro["k"]
    parts, rate = [], 24000
    for seg in segments:
        # Pausas DENTRO do bloco vêm da pontuação (respiração natural); o motor nunca para entre trechos sem motivo.
        samples, rate = k.create(seg["text"], voice=voice, speed=max(0.6, min(1.5, seg.get("speed", 1.0))), lang="pt-br", sentence_pause=seg.get("sentencePause", 0.0), clause_pause=seg.get("clausePause", 0.08))
        parts.append(samples.astype(np.float32))
    return parts, rate


def trim(x, rate, threshold=0.012):
    """Corta silêncio do começo/fim de cada trecho (a pausa vem do roteiro, não do modelo)."""
    idx = np.where(np.abs(x) > threshold)[0]
    if len(idx) == 0:
        return x
    pad = int(rate * 0.02)
    return x[max(0, idx[0] - pad): min(len(x), idx[-1] + pad)]


def main():
    job = json.load(sys.stdin)
    started = time.time()
    engine, voice, segments = job["engine"], job["voice"], job["segments"]
    parts, rate = (synth_piper if engine == "piper" else synth_kokoro)(job["modelDir"], voice, segments)
    out, timeline, t = [], [], 0.0
    lead = int(rate * job.get("leadMs", 0) / 1000)
    if lead:
        out.append(np.zeros(lead, np.float32))
        t = lead / rate
    for seg, audio in zip(segments, parts):
        audio = trim(audio, rate)
        start = t
        out.append(audio)
        t += len(audio) / rate
        # Tempos por palavra ESTIMADOS (sílabas): só servem de rascunho — a legenda usa o alinhamento do
        # áudio real (Whisper + roteiro, ver application/video-editing/word-alignment.ts).
        timeline.append({"text": seg["text"], "start": round(start, 3), "end": round(t, 3), "words": estimate_words(seg["text"], start, t), "estimated": True})
        gap = int(rate * seg.get("pauseAfterMs", 250) / 1000)
        out.append(np.zeros(gap, np.float32))
        t += gap / rate
    signal = np.concatenate(out)
    peak = float(np.max(np.abs(signal))) or 1.0
    signal = signal * (0.89 / peak)
    with wave.open(job["output"], "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(signal, -1, 1) * 32767).astype(np.int16).tobytes())
    json.dump({"sampleRate": rate, "durationSeconds": round(len(signal) / rate, 3), "segments": timeline, "generationMs": int((time.time() - started) * 1000), "peakRssMb": round(rss_mb(), 1)}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
