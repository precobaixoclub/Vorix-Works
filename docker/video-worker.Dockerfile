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
    && rm -rf /var/lib/apt/lists/*

COPY scripts/install-ffmpeg-linux.sh /tmp/install-ffmpeg-linux.sh
RUN sh /tmp/install-ffmpeg-linux.sh /opt/vorix/ffmpeg && rm /tmp/install-ffmpeg-linux.sh

COPY scripts/meetings/requirements.txt /tmp/whisper-requirements.txt
RUN python3 -m venv /opt/whisper \
    && /opt/whisper/bin/pip install --no-cache-dir -r /tmp/whisper-requirements.txt \
    && rm /tmp/whisper-requirements.txt

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/meetings/faster_whisper_transcribe.py ./scripts/meetings/faster_whisper_transcribe.py
RUN mkdir -p /data/whisper-cache /data/video-work && chown -R node:node /data
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/interfaces/worker/video-worker.js"]
