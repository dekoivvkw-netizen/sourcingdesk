# SourcingDesk

Gestionale per il sourcing di offerte e fornitori. Stack: Node 22 con `node:http` puro, MySQL 8 tramite `mysql2`, frontend HTML/JS in italiano.

## Avvio con Docker Compose
```bash
cp .env.example .env    # imposta almeno le password
docker compose up --build
# http://localhost:3000
```
All'avvio il container esegue le migrazioni e poi il server. Gira come `USER node` e ha un `HEALTHCHECK` su `/health`.

## Avvio locale
```bash
npm install
export DATABASE_URL=mysql://utente:pass@127.0.0.1:3306/sourcingdesk
npm run migrate && npm start
```

## App sul telefono (PWA)
L'interfaccia è una Progressive Web App con `manifest.json`, icone (`public/icons/`), meta per iOS e layout mobile (navigazione in basso, tabelle mostrate come schede, moduli richiudibili).
Il service worker `public/sw.js` mette in cache **solo gli asset statici**, con strategia network-first. Le richieste `/api/*` e `/health` non vengono mai intercettate né salvate in cache.
- **Android/Chrome:** menu ⋮ → "Installa app".
- **iPhone/Safari:** Condividi → "Aggiungi alla schermata Home".

L'installazione richiede HTTPS (oppure `localhost`).

## Esecuzione persistente sul box: `start.sh` / `stop.sh`
`./start.sh` (ri)avvia, in quest'ordine:
- MySQL 8.4 con i dati su disco in `data/mysql`; i binari stanno in `.runtime/`;
- le migrazioni;
- il server sulla porta 3000, con `COOKIE_SECURE=true` e `TRUST_PROXY=true`;
- un Cloudflare Quick Tunnel. Per non avviarlo: `NO_TUNNEL=1 ./start.sh`.

Log in `data/logs/`, PID in `data/run/`. La password del DB viene generata una sola volta in `data/db.env` (chmod 600). `./stop.sh` ferma tutto e i dati restano su disco.

## Test
```bash
npm test                                   # unit test (senza DB)
TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/sourcingdesk_test npm test   # usa un DB dedicato: i test scrivono dati   # più integrazione end-to-end
npm run lint
```

## Variabili d'ambiente
Sono descritte in `.env.example`: PORT, DATABASE_URL, SESSION_TTL_HOURS, COOKIE_SECURE, AI_API_KEY/AI_BASE_URL/AI_MODEL/AI_TIMEOUT_MS, ROBOT_TIMEOUT_MS/ROBOT_MAX_BYTES/ROBOT_RATE_LIMIT/ROBOT_RATE_WINDOW_MS e ALLOW_PRIVATE_FETCH (solo per lo sviluppo), TRUST_PROXY (dietro un proxy/tunnel, per avere l'IP reale nel rate limit).
Se `AI_API_KEY` è vuota, la valutazione usa un'euristica locale.

## API (JSON, `Content-Type: application/json` obbligatorio per i POST/PUT, altrimenti 415)
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- `GET|POST /api/suppliers`, `GET|PUT|DELETE /api/suppliers/:id`
- `GET|POST /api/offers`, `GET|PUT|DELETE /api/offers/:id`. Il POST fa la deduplica: risponde 201 se l'offerta è nuova e 200 se esisteva già.
- `POST /api/robots/run` con `{ "url": "https://..." }`: importa una pagina pubblica.
- `GET /api/audit`, `GET /health`

Autenticazione tramite cookie HttpOnly SameSite=Strict oppure `Authorization: Bearer <token>`. Password con scrypt; nel DB è salvato solo lo sha256 del token.

## Le 7 correzioni di sicurezza integrate
1. **Audit**: la `verification` viene calcolata prima di scrivere l'audit e salvata in `meta.verification`.
2. **SSRF**: blocco di IPv4 e IPv6 privati, loopback, link-local, ULA, IPv4-mapped e intervalli riservati. L'IP risolto viene fissato e ricontrollato a ogni redirect; ci sono timeout e limite di byte.
3. **Ownership**: ogni query è filtrata su `created_by`; una risorsa di un altro utente risponde 404.
4. **Timeout AI**: AbortController con `AI_TIMEOUT_MS`; in caso di errore si passa all'euristica.
5. **Docker**: `node:22-alpine`, `USER node`, `HEALTHCHECK`.
6. **Dedupe**: `dedupe_hash` UNIQUE per utente, `INSERT ... ON DUPLICATE KEY UPDATE`. Per i DB esistenti c'è `migrations/upgrade_legacy_dedupe.sql.example`, che fa un backup dei duplicati e tiene il più recente.
7. **Rate limit**: rate limiter in memoria su `/api/robots/run` e sull'autenticazione, risposta 429 con `Retry-After`.

## Limiti noti
- Il rate limiter e lo stato sono in memoria per processo: con più istanze serve Redis o un sistema simile.
- Il robot estrae solo JSON-LD, Open Graph e `<title>`; non esegue JavaScript.
- Dietro un reverse proxy TLS imposta `COOKIE_SECURE=true`.

## Database: MySQL oppure PostgreSQL

Il dialetto viene scelto dallo schema di `DATABASE_URL`: `mysql://…` usa mysql2 e `migrations/mysql/`; `postgres://…` / `postgresql://…` usa pg e `migrations/postgres/`. La deduplica usa `ON DUPLICATE KEY UPDATE` su MySQL e `ON CONFLICT (dedupe_hash) DO UPDATE` su PostgreSQL. Per un Postgres esterno che richiede TLS aggiungi `?sslmode=require` all'URL.

## Deploy su Render (piano gratuito)

Web service Docker (questo Dockerfile) + Render Postgres. Variabili: `DATABASE_URL` (Internal Database URL), `COOKIE_SECURE=true`, `TRUST_PROXY=true`. Le migrazioni partono all'avvio. Limiti del piano Free: il servizio va in sospensione dopo 15 minuti senza traffico (riavvio in circa 1 minuto); il Postgres Free scade 30 giorni dopo la creazione (poi 14 giorni per passare a un piano a pagamento, altrimenti viene cancellato) e ha 1 GB.
