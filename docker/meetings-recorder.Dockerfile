FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    MEETINGS_CHROMIUM_PATH=/usr/bin/chromium \
    MEETINGS_FFMPEG_PATH=/usr/bin/ffmpeg \
    MEETINGS_FFPROBE_PATH=/usr/bin/ffprobe \
    MEETINGS_XVFB_PATH=/usr/bin/Xvfb \
    MEETINGS_PACTL_PATH=/usr/bin/pactl \
    PULSE_SERVER=unix:/tmp/pulse/native

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg xvfb pulseaudio pulseaudio-utils dbus-x11 \
      fonts-liberation fonts-noto-color-emoji ca-certificates procps tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 recorder \
    && mkdir -p /app /tmp/pulse /tmp/vorix-recorder-displays \
    && chown -R recorder:recorder /app /tmp/pulse /tmp/vorix-recorder-displays

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/meetings/recorder-entrypoint.sh ./scripts/meetings/recorder-entrypoint.sh
RUN chmod 0755 ./scripts/meetings/recorder-entrypoint.sh

USER recorder
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
  CMD pgrep -f "dist/interfaces/worker/meetings-recorder-worker.js" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/meetings/recorder-entrypoint.sh"]
