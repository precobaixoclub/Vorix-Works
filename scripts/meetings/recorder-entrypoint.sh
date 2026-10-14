#!/bin/sh
set -eu

mkdir -p /tmp/pulse
pulseaudio --daemonize=yes --exit-idle-time=-1 --log-target=stderr

exec node dist/interfaces/worker/meetings-recorder-worker.js
