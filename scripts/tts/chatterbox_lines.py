#!/usr/bin/env python3
"""
Chatterbox multilingual (MIT) — gera UMA fala por linha (referência de qualidade; não roda no VPS atual:
~4,5 GB de RAM e ~8× o tempo real em 12 threads). Timbre guiado por amostra SINTÉTICA (Kokoro, Apache-2.0),
nunca por voz de pessoa real sem autorização.

stdin: { "prompt": "amostra.wav", "exaggeration": 0.55, "lines": [ { "text": "...", "out": "linha1.wav" } ] }
"""
import json
import os
import sys
import time


def main():
    job = json.load(sys.stdin)
    import numpy as np
    import soundfile as sf
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    torch.set_num_threads(int(os.environ.get("TTS_THREADS", "8")))
    original_load = torch.load
    torch.load = lambda *a, **k: original_load(*a, **{**k, "map_location": torch.device("cpu")})
    model = ChatterboxMultilingualTTS.from_pretrained(device=torch.device("cpu"))
    out = []
    for line in job["lines"]:
        t0 = time.time()
        wav = model.generate(line["text"], language_id="pt", audio_prompt_path=job.get("prompt"), exaggeration=job.get("exaggeration", 0.5), cfg_weight=0.5)
        audio = wav.squeeze().cpu().numpy().astype(np.float32)
        idx = np.where(np.abs(audio) > 0.012)[0]
        if len(idx):
            audio = audio[max(0, idx[0] - 480): idx[-1] + 480]
        sf.write(line["out"], audio / (np.max(np.abs(audio)) or 1) * 0.89, model.sr, subtype="PCM_16")
        out.append({"out": line["out"], "seconds": round(len(audio) / model.sr, 3), "ms": int((time.time() - t0) * 1000)})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
