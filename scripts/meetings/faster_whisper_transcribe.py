"""Transcrição de UMA gravação com faster-whisper — chamado pelo worker do Vorix Meetings.

Entrada: WAV PCM 16 kHz mono (o worker já extraiu com ffmpeg). Lido com `wave` + numpy, sem
depender do PyAV. Saída: JSON (UTF-8) com segmentos, idioma, duração e métricas de recurso para
dimensionar o host do worker.

Uso:
  python faster_whisper_transcribe.py --audio in.wav --output out.json --model small \
      [--language pt] [--compute-type int8] [--threads 0] [--beam-size 5] [--cache-dir DIR]
"""

import argparse
import json
import os
import sys
import time
import wave


def peak_memory_mb():
    try:
        import resource  # Linux/macOS

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(peak / 1024 if sys.platform != "darwin" else peak / (1024 * 1024), 1)
    except ImportError:
        pass
    try:
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = Counters()
        counters.cb = ctypes.sizeof(Counters)
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ctypes.windll.psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb)
        return round(counters.PeakWorkingSetSize / (1024 * 1024), 1)
    except Exception:  # noqa: BLE001 — métrica é opcional
        return -1


def read_wav(path):
    import numpy as np

    with wave.open(path, "rb") as audio:
        if audio.getframerate() != 16000 or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise SystemExit("o áudio precisa ser WAV PCM 16-bit, 16 kHz, mono")
        frames = audio.readframes(audio.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default=None)
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--threads", type=int, default=0)
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--cache-dir", default=None)
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    cpu_start = time.process_time()
    started = time.time()
    model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type, cpu_threads=args.threads, download_root=args.cache_dir)
    loaded = time.time()
    audio = read_wav(args.audio)
    segments_iter, info = model.transcribe(audio, language=args.language, beam_size=args.beam_size, vad_filter=True)
    segments = [
        {"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text, "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob}
        for s in segments_iter
    ]
    finished = time.time()
    duration = float(info.duration)
    transcribe_seconds = finished - loaded
    result = {
        "language": info.language,
        "duration_seconds": round(duration, 3),
        "model": args.model,
        "segments": segments,
        "metrics": {
            "model_load_seconds": round(loaded - started, 2),
            "transcribe_seconds": round(transcribe_seconds, 2),
            "audio_seconds": round(duration, 2),
            "real_time_factor": round(transcribe_seconds / duration, 4) if duration > 0 else 0,
            "cpu_seconds": round(time.process_time() - cpu_start, 2),
            "peak_memory_mb": peak_memory_mb(),
            "cpu_threads": args.threads or os.cpu_count() or 0,
            "compute_type": args.compute_type,
            "language_probability": round(float(info.language_probability), 4),
        },
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)


if __name__ == "__main__":
    main()
