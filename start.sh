#!/usr/bin/env bash
# Avvia (o riavvia) MySQL persistente, il server SourcingDesk e un Cloudflare Quick Tunnel.
# Dati MySQL su disco in ./data/mysql. Binari in ./.runtime (mysql 8.4, libaio, cloudflared).
# Uso: ./start.sh            -> tutto
#      NO_TUNNEL=1 ./start.sh -> senza tunnel pubblico
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$PWD; RT=$ROOT/.runtime; DATA=$ROOT/data; RUN=$DATA/run; LOGS=$DATA/logs
MYSQL_PORT=${MYSQL_PORT:-3307}; APP_PORT=${PORT:-3000}
mkdir -p "$DATA/mysql" "$RUN" "$LOGS"; chmod 700 "$DATA"
export LD_LIBRARY_PATH=$RT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
MYSQLD=$RT/mysql/bin/mysqld
SOCK=$RUN/mysql.sock

stop_pid() { local f=$1; if [[ -f $f ]]; then local p; p=$(cat "$f"); if kill -0 "$p" 2>/dev/null; then kill "$p"; for _ in $(seq 30); do kill -0 "$p" 2>/dev/null || break; sleep 1; done; fi; rm -f "$f"; fi; }

echo "== arresto processi precedenti"
stop_pid "$RUN/tunnel.pid"; stop_pid "$RUN/server.pid"; stop_pid "$RUN/mysqld.pid"

# Password del DB generata una volta e conservata in data/db.env (chmod 600)
if [[ ! -f $DATA/db.env ]]; then
  ( umask 077; echo "DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)" > "$DATA/db.env" )
fi
# shellcheck disable=SC1091
source "$DATA/db.env"

MYOPTS=(--no-defaults --basedir="$RT/mysql" --datadir="$DATA/mysql" --socket="$SOCK" --port="$MYSQL_PORT"
  --bind-address=127.0.0.1 --mysqlx=OFF --pid-file="$RUN/mysqld.pid" --log-error="$LOGS/mysqld.err"
  --character-set-server=utf8mb4 --default-time-zone=+00:00 --innodb-buffer-pool-size=128M)

FIRST=0
if [[ ! -d $DATA/mysql/mysql ]]; then
  echo "== inizializzazione datadir MySQL"; FIRST=1
  "$MYSQLD" --no-defaults --basedir="$RT/mysql" --datadir="$DATA/mysql" --initialize-insecure --log-error="$LOGS/mysqld-init.err"
fi
echo "== avvio MySQL (porta $MYSQL_PORT)"
nohup "$MYSQLD" "${MYOPTS[@]}" >/dev/null 2>&1 &
if [[ ! -f $DATA/.bootstrapped ]]; then node scripts/local-db.js "$SOCK" "$DB_PASSWORD" --bootstrap && touch "$DATA/.bootstrapped"; else node scripts/local-db.js "$SOCK" "$DB_PASSWORD"; fi

export DATABASE_URL="mysql://sourcingdesk:$DB_PASSWORD@127.0.0.1:$MYSQL_PORT/sourcingdesk"
export PORT=$APP_PORT COOKIE_SECURE=${COOKIE_SECURE:-true} TRUST_PROXY=${TRUST_PROXY:-true}
echo "== migrazioni"; node scripts/migrate.js
echo "== avvio server (porta $APP_PORT, cookie Secure=$COOKIE_SECURE)"
nohup node src/server.js >>"$LOGS/server.log" 2>&1 & echo $! > "$RUN/server.pid"
for i in $(seq 30); do curl -sf "http://127.0.0.1:$APP_PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$APP_PORT/health" >/dev/null || { echo "server non risponde, vedi $LOGS/server.log"; exit 1; }

if [[ -z ${NO_TUNNEL:-} ]]; then
  echo "== avvio Cloudflare Quick Tunnel"
  : > "$LOGS/tunnel.log"
  nohup "$RT/cloudflared" tunnel --no-autoupdate --url "http://127.0.0.1:$APP_PORT" >>"$LOGS/tunnel.log" 2>&1 & echo $! > "$RUN/tunnel.pid"
  URL=""
  for i in $(seq 60); do URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true); [[ -n $URL ]] && break; sleep 1; done
  if [[ -n $URL ]]; then echo "$URL" > "$DATA/PUBLIC_URL.txt"; echo "URL pubblico: $URL"; else echo "tunnel: URL non trovato, vedi $LOGS/tunnel.log"; fi
fi
echo "== pronto: http://127.0.0.1:$APP_PORT"
