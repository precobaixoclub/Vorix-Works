"""Transcrição de UMA gravação com faster-whisper (CTranslate2) — chamado pelo worker do Vorix Meetings.

Entrada: WAV PCM 16 kHz mono (o worker já extraiu com ffmpeg). Saída: JSON (UTF-8) com segmentos,
idioma, duração e métricas de recurso para dimensionar o host do worker.

Perfil econômico para servidores pequenos (ver docs/meetings-transcription-benchmark.md):
- o áudio é lido em BLOCOS (padrão 10 min) e cortado num ponto de silêncio perto do limite — a RAM
  fica constante (~40 MB de áudio) em vez de crescer com a reunião (60 min = ~345 MB antes);
- `beam_size=1` (busca gulosa) e threads limitadas (padrão 1): o processo nunca ocupa a máquina;
- VAD do próprio faster-whisper (Silero ONNX, embutido): silêncio não passa pelo modelo;
- idioma automático, detectado no 1º bloco e fixado para os demais (sem trocar no meio da reunião);
- modelo lido do cache local; só baixa se ainda não existir (funciona sem internet depois).

Uso:
  python faster_whisper_transcribe.py --audio in.wav --output out.json [--model small]
      [--language auto|pt] [--compute-type int8] [--threads 1] [--beam-size 1] [--cache-dir DIR]
      [--chunk-seconds 600] [--no-vad] [--diarize pyannote] [--num-speakers N]

Separação de falantes (opcional): com `--diarize pyannote`, roda pyannote/speaker-diarization-3.1
(token do Hugging Face em MEETINGS_HF_TOKEN — nunca por argumento). Falha na separação NUNCA perde a
transcrição: o resultado sai sem falantes e com `diarization_error` nas métricas.
"""

import argparse
import json
import os
import sys
import time
import wave

SAMPLE_RATE = 16000
# Janela (s) em volta do limite do bloco onde se procura o trecho mais silencioso para cortar.
CUT_SEARCH_SECONDS = 5
CUT_FRAME_SECONDS = 0.1


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


def quietest_cut(np, buffer, target):
    """Índice (amostra) do trecho de menor energia em target ± CUT_SEARCH_SECONDS."""
    frame = int(CUT_FRAME_SECONDS * SAMPLE_RATE)
    start = max(frame, target - CUT_SEARCH_SECONDS * SAMPLE_RATE)
    end = min(len(buffer) - frame, target + CUT_SEARCH_SECONDS * SAMPLE_RATE)
    if end <= start:
        return target
    window = buffer[start:end]
    usable = (len(window) // frame) * frame
    energy = np.square(window[:usable].reshape(-1, frame)).mean(axis=1)
    return start + int(np.argmin(energy)) * frame + frame // 2


def audio_blocks(path, chunk_seconds):
    """Gera (offset_em_segundos, bloco_float32) lendo o WAV aos poucos, cortando em silêncio."""
    import numpy as np

    with wave.open(path, "rb") as audio:
        if audio.getframerate() != SAMPLE_RATE or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise SystemExit("o áudio precisa ser WAV PCM 16-bit, 16 kHz, mono")
        chunk = int(chunk_seconds * SAMPLE_RATE)
        lookahead = CUT_SEARCH_SECONDS * SAMPLE_RATE
        buffer = np.zeros(0, dtype=np.float32)
        consumed = 0
        while True:
            frames = audio.readframes(SAMPLE_RATE * 60)
            if frames:
                buffer = np.concatenate([buffer, np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0])
            while len(buffer) >= chunk + lookahead:
                cut = quietest_cut(np, buffer, chunk)
                yield consumed / SAMPLE_RATE, buffer[:cut]
                consumed += cut
                buffer = buffer[cut:]
            if not frames:
                break
        if len(buffer):
            yield consumed / SAMPLE_RATE, buffer


def load_model(args):
    from faster_whisper import WhisperModel

    options = dict(device="cpu", compute_type=args.compute_type, cpu_threads=args.threads, num_workers=1, download_root=args.cache_dir)
    try:
        # Já baixado: abre sem tocar a rede (transcrição funciona offline).
        return WhisperModel(args.model, local_files_only=True, **options), False
    except Exception:  # noqa: BLE001 — primeira execução: baixa uma única vez para o cache
        return WhisperModel(args.model, **options), True


def assign_speakers(audio_path, segments, num_speakers=None):
    from pyannote.audio import Pipeline

    token = os.environ.get("MEETINGS_HF_TOKEN") or None
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=token)
    options = {"num_speakers": num_speakers} if num_speakers else {}
    diarization = pipeline(audio_path, **options)
    turns = [(turn.start, turn.end, label) for turn, _, label in diarization.itertracks(yield_label=True)]
    speakers = set()
    for segment in segments:
        overlap = {}
        for start, end, label in turns:
            shared = min(segment["end"], end) - max(segment["start"], start)
            if shared > 0:
                overlap[label] = overlap.get(label, 0) + shared
        if overlap:
            segment["speaker"] = max(overlap, key=overlap.get)
            speakers.add(segment["speaker"])
    return len(speakers)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--language", default=None, help="código (pt) ou auto/vazio para detectar")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--beam-size", type=int, default=1)
    parser.add_argument("--cache-dir", default=None)
    parser.add_argument("--chunk-seconds", type=int, default=600)
    parser.add_argument("--no-vad", action="store_true")
    parser.add_argument("--diarize", default=None, choices=["pyannote"])
    parser.add_argument("--num-speakers", type=int, default=None)
    args = parser.parse_args()

    cpu_start = time.process_time()
    started = time.time()
    model, downloaded = load_model(args)
    loaded = time.time()

    language = None if (args.language or "auto").lower() == "auto" else args.language
    language_probability = 1.0 if language else 0.0
    segments = []
    duration = 0.0
    blocks = 0
    for offset, block in audio_blocks(args.audio, args.chunk_seconds):
        blocks += 1
        duration = offset + len(block) / SAMPLE_RATE
        pieces, info = model.transcribe(
            block,
            language=language,
            beam_size=args.beam_size,
            vad_filter=not args.no_vad,
            vad_parameters={"min_silence_duration_ms": 500},
            # Sem herdar o texto do trecho anterior: evita laços de repetição em reuniões longas.
            condition_on_previous_text=False,
        )
        for piece in pieces:
            segments.append({
                "start": round(offset + piece.start, 3), "end": round(offset + piece.end, 3), "text": piece.text,
                "avg_logprob": piece.avg_logprob, "no_speech_prob": piece.no_speech_prob,
            })
        if language is None:
            # Idioma do 1º bloco vale para a reunião inteira.
            language, language_probability = info.language, float(info.language_probability)

    diarization_metrics = {}
    if args.diarize == "pyannote" and segments:
        diarize_started = time.time()
        try:
            diarization_metrics["speakers_detected"] = assign_speakers(args.audio, segments, args.num_speakers)
        except Exception as error:  # noqa: BLE001 — a transcrição continua válida sem falantes
            diarization_metrics["diarization_error"] = str(error)[:300]
        diarization_metrics["diarization_seconds"] = round(time.time() - diarize_started, 2)
    finished = time.time()
    transcribe_seconds = finished - loaded
    result = {
        "language": language or "pt",
        "duration_seconds": round(duration, 3),
        "model": args.model,
        "segments": segments,
        "metrics": {
            "model_load_seconds": round(loaded - started, 2),
            "model_downloaded": downloaded,
            "transcribe_seconds": round(transcribe_seconds, 2),
            "audio_seconds": round(duration, 2),
            "real_time_factor": round(transcribe_seconds / duration, 4) if duration > 0 else 0,
            "cpu_seconds": round(time.process_time() - cpu_start, 2),
            "peak_memory_mb": peak_memory_mb(),
            "cpu_threads": args.threads or os.cpu_count() or 0,
            "compute_type": args.compute_type,
            "beam_size": args.beam_size,
            "vad": not args.no_vad,
            "blocks": blocks,
            "language_probability": round(language_probability, 4),
            **diarization_metrics,
        },
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False)


if __name__ == "__main__":
    main()
