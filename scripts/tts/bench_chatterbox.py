#!/usr/bin/env python3
"""
Chatterbox multilingual (Resemble AI, licença MIT) — mesmas 4 interpretações do banco de vozes.
Sem clonar voz de terceiros: (1) voz padrão do modelo; (2) voz guiada por uma amostra SINTÉTICA do
Kokoro pf_dora (Apache-2.0), para um timbre brasileiro. Mede tempo, RAM, entonação e inteligibilidade.

  python bench_chatterbox.py <outDir> <promptWav>
"""
import json
import os
import sys
import time

import numpy as np
import psutil
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from bench_voices import CAMPAIGNS, pauses, pitch_stats, wer  # noqa: E402

EXAGGERATION = {"moda": 0.55, "tecnologia": 0.45, "casamento": 0.6, "ofertas": 0.7}


def main():
    out_dir, prompt = sys.argv[1], sys.argv[2]
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    torch.set_num_threads(int(os.environ.get("TTS_THREADS", "8")))
    # O checkpoint foi salvo em GPU: sem CUDA, tudo é mapeado para a CPU.
    original_load = torch.load
    torch.load = lambda *a, **k: original_load(*a, **{**k, "map_location": torch.device("cpu")})
    t0 = time.time()
    model = ChatterboxMultilingualTTS.from_pretrained(device=torch.device("cpu"))
    load_ms = int((time.time() - t0) * 1000)
    results = []
    for variant, prompt_path in (("padrao", None), ("timbre-dora", prompt)):
        for name, camp in CAMPAIGNS.items():
            pieces = []
            t1 = time.time()
            for line in camp["lines"]:
                wav = model.generate(line, language_id="pt", audio_prompt_path=prompt_path, exaggeration=EXAGGERATION[name], cfg_weight=0.5)
                audio = wav.squeeze().cpu().numpy().astype(np.float32)
                pieces += [audio, np.zeros(int(model.sr * camp["profile"]["pause"] / 1000), np.float32)]
            ms = int((time.time() - t1) * 1000)
            signal = np.concatenate(pieces)
            path = os.path.join(out_dir, f"{name}__chatterbox-{variant}.wav")
            sf.write(path, signal / (np.max(np.abs(signal)) or 1) * 0.89, model.sr)
            dur = len(signal) / model.sr
            results.append({"campaign": name, "engine": "chatterbox", "voice": variant, "file": os.path.basename(path), "generationMs": ms, "durationSeconds": round(dur, 2), "rtf": round(ms / 1000 / dur, 2), "peakRssMb": round(psutil.Process().memory_info().rss / 1048576), "pitch": pitch_stats(signal, model.sr), "pauses": len(pauses(signal, model.sr)), "loadMs": load_ms})
            print(name, variant, ms, "ms", round(dur, 2), "s", results[-1]["pitch"], flush=True)
    from faster_whisper import WhisperModel
    asr = WhisperModel("small", device="cpu", compute_type="int8")
    for r in results:
        segs, _ = asr.transcribe(os.path.join(out_dir, r["file"]), language="pt", beam_size=5)
        r["transcript"] = " ".join(s.text for s in segs).strip()
        r["wer"] = wer(" ".join(CAMPAIGNS[r["campaign"]]["lines"]), r["transcript"])
    with open(os.path.join(out_dir, "metricas-chatterbox.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("ok")


if __name__ == "__main__":
    main()
