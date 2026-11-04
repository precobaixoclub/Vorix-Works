# Worker de processamento do Vorix Meetings: transcrição LOCAL (faster-whisper + whisper.cpp) e
# análise. Imagem própria — não herda a do gravador (Chrome/Xvfb/PulseAudio não servem aqui).
# Sem PyTorch: o faster-whisper usa CTranslate2 (INT8) e o VAD Silero em ONNX que já vêm no pacote.
# Modelos NÃO entram na imagem: são baixados uma única vez para o volume do cache
# (MEETINGS_WHISPER_CACHE_DIR) e reaproveitados entre jobs e deploys.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN NODE_OPTIONS=--max-old-space-size=2048 npm run build

FROM node:20-bookworm-slim
ARG WHISPER_CPP_RELEASE=b4938
ENV NODE_ENV=production \
    MEETINGS_FFMPEG_PATH=/usr/bin/ffmpeg \
    MEETINGS_WHISPER_PYTHON=/opt/whisper/bin/python \
    MEETINGS_WHISPER_CACHE_DIR=/data/whisper-cache \
    MEETINGS_WHISPER_CPP_PATH=/opt/whisper-cpp/whisper-cli \
    MEETINGS_WHISPER_CPP_MODEL_DIR=/data/whisper-cache/ggml \
    LD_LIBRARY_PATH=/opt/whisper-cpp \
    HF_HUB_DISABLE_TELEMETRY=1 \
    OMP_NUM_THREADS=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-venv libgomp1 ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/meetings/requirements.txt /tmp/whisper-requirements.txt
RUN python3 -m venv /opt/whisper \
    && /opt/whisper/bin/pip install --no-cache-dir -r /tmp/whisper-requirements.txt \
    && rm /tmp/whisper-requirements.txt

# whisper.cpp (modo econômico): binário oficial pré-compilado, só o CLI e as bibliotecas dele.
RUN curl -fsSL -o /tmp/whisper-cpp.tgz "https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_RELEASE}/whisper-bin-ubuntu-x64.tar.gz" \
    && mkdir -p /opt/whisper-cpp \
    && tar -xzf /tmp/whisper-cpp.tgz -C /opt/whisper-cpp --strip-components=1 \
    && find /opt/whisper-cpp -maxdepth 1 -type f ! -name 'whisper-cli' ! -name 'lib*.so*' -delete \
    && rm -f /opt/whisper-cpp/libparakeet* /tmp/whisper-cpp.tgz \
    && ! LD_LIBRARY_PATH=/opt/whisper-cpp ldd /opt/whisper-cpp/whisper-cli | grep 'not found'

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts/meetings/faster_whisper_transcribe.py ./scripts/meetings/faster_whisper_transcribe.py
RUN mkdir -p /data/whisper-cache && chown -R node:node /data
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/interfaces/worker/meetings-worker.js"]
