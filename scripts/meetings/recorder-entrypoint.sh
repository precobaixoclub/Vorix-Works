#!/bin/sh
set -eu

# PulseAudio do container num caminho FIXO — o mesmo de PULSE_SERVER (unix:/tmp/pulse/native), que o
# worker usa para criar um sink exclusivo por gravação. Sem isto o daemon cria /tmp/pulse-<aleatório>
# e o pactl não o encontra.
export PULSE_RUNTIME_PATH=/tmp/pulse

# Estado de uma execução anterior (container reiniciado) é descartado: um arquivo `pid` antigo pode
# coincidir com um processo vivo e o PulseAudio se recusa a subir achando que já está rodando.
rm -rf /tmp/pulse /tmp/pulse-* "${HOME}/.config/pulse" /tmp/recorder-health
mkdir -p /tmp/pulse

pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit --log-target=stderr

attempt=0
until pactl info >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    echo "[recorder-entrypoint] PulseAudio não respondeu" >&2
    exit 1
  fi
  sleep 0.5
done

exec node dist/interfaces/worker/meetings-recorder-worker.js
