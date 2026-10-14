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
    MEETINGS_CHROMIUM_PATH=/usr/bin/google-chrome-stable \
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

# Official Chrome stable is a compatibility candidate for Google's supported-browser login.
# Keep the distro Chromium available for diagnostics. Browser authentication remains unproven
# until a user completes login; no stealth flags or security-check bypass are applied.
ADD https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb /tmp/google-chrome-stable.deb
RUN test "$(dpkg --print-architecture)" = amd64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/google-chrome-stable.deb \
    && google-chrome-stable --version \
    && rm -f /tmp/google-chrome-stable.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/meetings/recorder-entrypoint.sh ./scripts/meetings/recorder-entrypoint.sh
RUN chmod 0755 ./scripts/meetings/recorder-entrypoint.sh

USER recorder
# Saudável = o worker falou com o banco nos últimos 60 s (timer próprio, vale também durante uma
# gravação longa) E o PulseAudio do container responde. Processo vivo sem banco/áudio não conta.
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
  CMD sh -c 'test -f /tmp/recorder-health && [ $(( $(date +%s) - $(stat -c %Y /tmp/recorder-health) )) -lt 60 ] && pactl info >/dev/null 2>&1' || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/meetings/recorder-entrypoint.sh"]
