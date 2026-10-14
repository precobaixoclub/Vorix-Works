FROM vorix-meetings-recorder:customer-managed-0148
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/meetings/requirements.txt scripts/meetings/faster_whisper_transcribe.py /app/scripts/meetings/
RUN python3 -m venv /opt/whisper \
    && /opt/whisper/bin/pip install --no-cache-dir -r /app/scripts/meetings/requirements.txt
USER recorder
HEALTHCHECK NONE
ENTRYPOINT ["node", "dist/interfaces/worker/meetings-worker.js"]
