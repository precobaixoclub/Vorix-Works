#!/bin/sh
# Gate de release em Linux (autoridade de release): container descartável, sem .env, sem segredos,
# sem acesso aos containers de produção — só o código do commit.
#
# Uso (no host): sh scripts/ci/linux-release-gate.sh <diretório-com-o-código-do-commit> <rótulo>
# Resultado: <diretório>/.gate-test.out (TAP completo) e <diretório>/../<rótulo>.log (resumo).
#
# O ambiente espelha a imagem de produção (Dockerfile): node:20-slim (Debian), fontconfig com as
# fontes do renderer e o FFmpeg oficial do runtime (`scripts/install-ffmpeg-linux.sh`).
set -eu
WORKDIR="$1"; LABEL="$2"
LOG="$(dirname "$WORKDIR")/$LABEL.log"
docker run --rm --name "vorix-gate-$LABEL" --cpus=1.5 --cpu-shares=256 \
  -v "$WORKDIR":/app -w /app node:20.20.2-slim sh -c '
    echo "OS=$(. /etc/os-release; echo $PRETTY_NAME) NODE=$(node -v) NPM=$(npm -v) CPUS=$(nproc)"
    apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends fontconfig ca-certificates curl xz-utils >/dev/null && echo APT_OK
    set -eu
    step(){ name=$1; shift; s=$(date +%s); if "$@" > "/tmp/$name.out" 2>&1; then rc=0; else rc=$?; fi; echo "STEP $name rc=$rc secs=$(( $(date +%s) - s ))"; tail -3 "/tmp/$name.out"; return "$rc"; }
    step ffmpeg sh scripts/install-ffmpeg-linux.sh /opt/vorix/ffmpeg
    step npm_ci npm ci
    step typecheck npm run typecheck
    step build npm run build
    mkdir -p /usr/local/share/fonts/vorix /etc/fonts/conf.d \
      && cp dist/infrastructure/rendering/assets/geist-regular.ttf /usr/local/share/fonts/vorix/GeistEditorial-Regular.ttf \
      && cp dist/infrastructure/rendering/assets/dm-serif-display-regular.ttf /usr/local/share/fonts/vorix/DMSerifDisplay-Regular.ttf \
      && printf "%s\n" "<?xml version=\"1.0\"?>" "<!DOCTYPE fontconfig SYSTEM \"urn:fontconfig:fonts.dtd\">" "<fontconfig>" "  <dir>/usr/local/share/fonts/vorix</dir>" "  <alias>" "    <family>GeistEditorial</family>" "    <prefer><family>Geist</family></prefer>" "  </alias>" "</fontconfig>" > /etc/fonts/conf.d/60-vorix-geist-editorial.conf \
      && fc-cache -f /usr/local/share/fonts/vorix >/dev/null && echo FONT_OK
    step architecture npm run architecture:check
    s=$(date +%s); if npm test > /tmp/test.out 2>&1; then rc=0; else rc=$?; fi; echo "STEP npm_test rc=$rc secs=$(( $(date +%s) - s ))"
    grep -E "^# (tests|pass|fail|cancelled|skipped|todo)" /tmp/test.out || true
    grep -E "^not ok" /tmp/test.out | head -40 || true
    cp /tmp/test.out /app/.gate-test.out
    exit "$rc"
  ' > "$LOG" 2>&1
echo "DONE $LABEL" >> "$LOG"
