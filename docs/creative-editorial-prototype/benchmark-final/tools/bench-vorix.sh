#!/bin/sh
# Benchmark final — lado VORIX. Uma geração por cenário, perfil aplicado antes de cada uma.
# Uso: bench-vorix.sh <logoAssetId> <S1:P3 S2:P2 ...>
ASSET="$1"; shift
LOG=/tmp/bench/vorix.log
mkdir -p /tmp/bench
for pair in "$@"; do
  S=${pair%%:*}; P=${pair##*:}
  echo "=== $S $P $(date -u +%FT%TZ)" >> $LOG
  /tmp/hom.sh identity /tmp/profile-$P.json "$ASSET" >> $LOG 2>&1
  cp /tmp/bench/body-$S.json /tmp/bench/run-$S.json
  /tmp/real-run.sh /tmp/bench/run-$S.json "bench-$S" >> $LOG 2>&1
done
echo BENCH_VORIX_DONE >> $LOG
