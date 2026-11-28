# Worker do motor de vídeo (Marketing › Criar vídeo com IA): planejamento por IA + render FFmpeg +
# Quality Gate + transcrição local (mesmo faster-whisper do Meetings, mesmo cache de modelos).
# FFmpeg: o build vetado de produção (jellyfin-ffmpeg 7.0.2, sha256 conferido — o mesmo da API e da
# medição controlada no VPS), com libass para títulos/legendas. Nenhum ffmpeg de pacote é usado.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN NODE_OPTIONS=--max-old-space-size=2048 npm run build

FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    MEETINGS_WHISPER_PYTHON=/opt/whisper/bin/python \
    MEETINGS_WHISPER_CACHE_DIR=/data/whisper-cache \
    VIDEO_WORK_DIR=/data/video-work \
    HF_HUB_DISABLE_TELEMETRY=1 \
    OMP_NUM_THREADS=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv libgomp1 ca-certificates curl xz-utils tini \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/install-ffmpeg-linux.sh /tmp/install-ffmpeg-linux.sh
RUN sh /tmp/install-ffmpeg-linux.sh /opt/vorix/ffmpeg && rm /tmp/install-ffmpeg-linux.sh

COPY scripts/meetings/requirements.txt /tmp/whisper-requirements.txt
RUN python3 -m venv /opt/whisper \
    && /opt/whisper/bin/pip install --no-cache-dir -r /tmp/whisper-requirements.txt \
    && rm /tmp/whisper-requirements.txt

# Locução local (Kokoro ONNX, sem PyTorch e sem API paga) — versões e modelos idênticos aos do laboratório de
# sincronia. Medido no VPS (2 CPUs/3 GiB): +206 MB de pacotes, +338 MB de modelos, 18 s de fala em ~76 s, 604 MB
# de pico. Pesos Apache-2.0 (github.com/thewh1teagle/kokoro-onnx); o build falha se o hash não conferir.
COPY scripts/tts/requirements-worker.txt /tmp/tts-requirements.txt
RUN python3 -m venv /opt/tts \
    && /opt/tts/bin/pip install --no-cache-dir -r /tmp/tts-requirements.txt \
    && rm /tmp/tts-requirements.txt \
    && mkdir -p /opt/tts-models \
    && curl -fsSL -o /opt/tts-models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
    && curl -fsSL -o /opt/tts-models/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
    && echo "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5  /opt/tts-models/kokoro-v1.0.onnx" | sha256sum -c - \
    && echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /opt/tts-models/voices-v1.0.bin" | sha256sum -c -
ENV TTS_PYTHON=/opt/tts/bin/python \
    TTS_MODEL_DIR=/opt/tts-models

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/meetings/faster_whisper_transcribe.py ./scripts/meetings/faster_whisper_transcribe.py
COPY scripts/tts/tts_runner.py ./scripts/tts/tts_runner.py
# Motion design (Remotion): composições + Chromium headless. Licença: gratuita até 3 pessoas na organização;
# acima disso exige Company License (ver docs/remotion-motion-design.md).
COPY motion-graphics/package.json motion-graphics/package-lock.json ./motion-graphics/
RUN cd motion-graphics && npm ci --omit=dev && npm cache clean --force
COPY motion-graphics/src ./motion-graphics/src
COPY motion-graphics/render.mjs ./motion-graphics/render.mjs
COPY src/infrastructure/rendering/assets ./src/infrastructure/rendering/assets
RUN chown -R node:node /app/motion-graphics \
    && su node -s /bin/sh -c "cd /app/motion-graphics && node --input-type=module -e \"import('@remotion/renderer').then((m) => m.ensureBrowser())\""
RUN mkdir -p /data/whisper-cache /data/video-work && chown -R node:node /data
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/interfaces/worker/video-worker.js"]
