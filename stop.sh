#!/usr/bin/env bash
# Ferma tunnel, server e MySQL avviati da start.sh (i dati restano in ./data).
cd "$(dirname "$0")"; RUN=data/run
for n in tunnel server mysqld; do f=$RUN/$n.pid; [[ -f $f ]] && { p=$(cat "$f"); kill "$p" 2>/dev/null && echo "fermato $n ($p)"; for _ in $(seq 30); do kill -0 "$p" 2>/dev/null || break; sleep 1; done; rm -f "$f"; }; done
