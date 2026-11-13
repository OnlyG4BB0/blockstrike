#!/usr/bin/env bash
# Installa (o aggiorna) il server di BLOCKSTRIKE sulla VPS, accanto a quello che c'è già.
#
#   curl -fsSL https://raw.githubusercontent.com/OnlyG4BB0/blockstrike/main/deploy/vps/install.sh | bash -s -- <IP pubblico>
#
# Senza Docker, per stare leggero sulle VPS piccole (1 GB) condivise con altri programmi:
#   - il server di gioco gira con il Node già installato (serve 22.6 o più nuovo), servizio
#     blockstrike-game, utente blockstrike, codice in /opt/blockstrike, solo su 127.0.0.1:2567;
#   - Caddy (programma ufficiale, verificato con la sua firma SHA-512) fa https e wss sulla 443,
#     servizio blockstrike-caddy, certificato Let's Encrypt preso sulla 443 stessa.
# Cosa NON fa: non aggiorna Node, non tocca nginx né la porta 80, non ferma e non cambia altri
# servizi (per esempio bobertbot). Se la porta 443 è già usata da altro, si ferma prima di cambiare
# qualcosa.
set -euo pipefail

IP="${1:-}"
if ! [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "Uso: install.sh <IP pubblico della VPS>   (lo trovi nella console Oracle, nella pagina dell'istanza)"
  exit 1
fi
DOMAIN="${IP//./-}.sslip.io"
SITE="${BLOCKSTRIKE_SITE:-https://onlyg4bb0.github.io/blockstrike/}"
REPO="${BLOCKSTRIKE_REPO:-https://github.com/OnlyG4BB0/blockstrike.git}"
BRANCH="${BLOCKSTRIKE_BRANCH:-main}"
APP=/opt/blockstrike
CADDY_DIR=/opt/blockstrike-caddy
CADDY_VERSION=2.10.2
GAME_PORT=2567

# Oracle Cloud Shell (il terminale nel browser della console) non è la VPS: lì non si installa niente.
if [ "${OCI_CLI_CLOUD_SHELL:-}" = "True" ]; then
  echo "Questo terminale è la Cloud Shell di Oracle, non la VPS: non installo niente qui."
  echo "Entra prima nella VPS (per esempio: ssh ubuntu@$IP) e lancia lì lo stesso comando."
  exit 1
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true 2>/dev/null && ! sudo -v 2>/dev/null; then
    echo "Serve sudo (o l'utente root) per installare: su questa macchina non c'è o non è permesso."
    echo "Se sei nella Cloud Shell di Oracle (il terminale nel browser) non sei sulla VPS: entra prima con ssh ubuntu@$IP."
    exit 1
  fi
  SUDO="sudo"
fi
for cmd in ss systemctl curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Manca il comando '$cmd': mi fermo senza cambiare niente."; exit 1; }
done

ours() { systemctl is-active --quiet "$1" 2>/dev/null; }

echo "== 1. Porte 443 e $GAME_PORT (la 80 non serve: resta a chi la usa già)"
check_port() {
  local port="$1" unit="$2" listeners
  listeners="$($SUDO ss -ltnH "sport = :$port")" || { echo "Non riesco a controllare la porta $port: mi fermo."; exit 1; }
  if [ -n "$listeners" ] && ! ours "$unit"; then
    echo "La porta $port è già usata da un altro programma: mi fermo senza cambiare niente."
    $SUDO ss -ltnp "sport = :$port" || true
    exit 1
  fi
}
check_port 443 blockstrike-caddy
check_port "$GAME_PORT" blockstrike-game
echo "libere (o già di BLOCKSTRIKE)"

echo "== 2. Node (si usa quello che c'è, non lo aggiorno)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node non c'è. Installalo (22.6 o più nuovo) e rilancia: non lo installo io per non cambiare altri programmi."
  exit 1
fi
NODE_BIN="$(command -v node)"
NODE_VER="$(node -p 'process.versions.node')"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=6)?0:1)'; then
  echo "Node $NODE_VER è troppo vecchio: serve 22.6 o più nuovo. Non lo aggiorno io (altri programmi lo usano)."
  exit 1
fi
command -v npm >/dev/null 2>&1 || { echo "Manca npm accanto a Node: mi fermo."; exit 1; }
command -v git >/dev/null 2>&1 || { $SUDO apt-get update -q && $SUDO apt-get install -y -q git; }
echo "Node $NODE_VER"

echo "== 3. Utente e codice in $APP"
id blockstrike >/dev/null 2>&1 || $SUDO useradd --system --home-dir "$APP" --shell /usr/sbin/nologin blockstrike
$SUDO mkdir -p "$APP"
$SUDO chown blockstrike:blockstrike "$APP"
as_app() { $SUDO -u blockstrike env HOME="$APP" "$@"; }
if [ -d "$APP/src/.git" ]; then
  as_app git -C "$APP/src" fetch -q --depth 1 origin "$BRANCH"
  as_app git -C "$APP/src" reset -q --hard FETCH_HEAD
else
  as_app git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$APP/src"
fi
echo "Dipendenze del server (qualche minuto la prima volta)"
(cd "$APP/src" && as_app npm ci --omit=dev --workspace @blockstrike/server --no-audit --no-fund --loglevel=error)

echo "== 4. Caddy $CADDY_VERSION in $CADDY_DIR"
case "$(uname -m)" in
  x86_64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Processore $(uname -m) non previsto: mi fermo."; exit 1 ;;
esac
if ! [ -x "$CADDY_DIR/caddy" ] || ! "$CADDY_DIR/caddy" version 2>/dev/null | grep -q "v$CADDY_VERSION "; then
  TMP="$(mktemp -d)"
  NAME="caddy_${CADDY_VERSION}_linux_${ARCH}.tar.gz"
  BASE="https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION"
  curl -fsSL -o "$TMP/$NAME" "$BASE/$NAME"
  curl -fsSL -o "$TMP/sums.txt" "$BASE/caddy_${CADDY_VERSION}_checksums.txt"
  (cd "$TMP" && grep " $NAME\$" sums.txt | sha512sum -c --quiet) || { echo "La firma di Caddy non torna: mi fermo."; rm -rf "$TMP"; exit 1; }
  tar -xzf "$TMP/$NAME" -C "$TMP" caddy
  $SUDO install -d -o root -g root "$CADDY_DIR"
  $SUDO install -m 0755 "$TMP/caddy" "$CADDY_DIR/caddy"
  rm -rf "$TMP"
fi
$SUDO install -d -o blockstrike -g blockstrike /var/lib/blockstrike-caddy

echo "== 5. Servizi blockstrike-game e blockstrike-caddy"
$SUDO tee /etc/systemd/system/blockstrike-game.service >/dev/null <<EOF
[Unit]
Description=BLOCKSTRIKE - server di gioco
After=network-online.target
Wants=network-online.target

[Service]
User=blockstrike
WorkingDirectory=$APP/src
Environment=NODE_ENV=production PORT=$GAME_PORT CLIENT_DIR=
ExecStart=$NODE_BIN --experimental-strip-types --disable-warning=ExperimentalWarning --max-old-space-size=192 server/src/index.ts
Restart=on-failure
RestartSec=5
MemoryMax=300M
Nice=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
$SUDO tee /etc/systemd/system/blockstrike-caddy.service >/dev/null <<EOF
[Unit]
Description=BLOCKSTRIKE - https e wss sulla porta 443 (Caddy)
After=network-online.target blockstrike-game.service
Wants=network-online.target

[Service]
User=blockstrike
Environment=DOMAIN=$DOMAIN SITE=$SITE UPSTREAM=127.0.0.1:$GAME_PORT XDG_DATA_HOME=/var/lib/blockstrike-caddy XDG_CONFIG_HOME=/var/lib/blockstrike-caddy
ExecStart=$CADDY_DIR/caddy run --config $APP/src/deploy/vps/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=5
MemoryMax=150M
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/blockstrike-caddy

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable -q blockstrike-game blockstrike-caddy
$SUDO systemctl restart blockstrike-game blockstrike-caddy

echo "== 6. Firewall della macchina: la 443 dev'essere aperta"
if command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
  $SUDO firewall-cmd --permanent --add-service=https >/dev/null
  $SUDO firewall-cmd --reload >/dev/null
elif command -v iptables >/dev/null 2>&1; then
  if $SUDO iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT 2>/dev/null; then
    echo "già aperta"
  else
    $SUDO iptables -I INPUT 1 -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT
    if command -v netfilter-persistent >/dev/null 2>&1; then $SUDO netfilter-persistent save >/dev/null 2>&1 || true; fi
    echo "aperta"
  fi
fi

echo "== 7. Attendo il certificato per $DOMAIN"
for _ in $(seq 1 40); do
  if curl -fsS "https://$DOMAIN/" >/dev/null 2>&1; then
    curl -fsS "https://$DOMAIN/"; echo
    echo
    echo "Pronto. Indirizzo del server per la pagina e per l'app: wss://$DOMAIN"
    exit 0
  fi
  sleep 3
done
echo "Il certificato non è ancora arrivato. Di solito manca la regola nella console Oracle:"
echo "  Networking → Virtual Cloud Network → Security List → Ingress: TCP 443 da 0.0.0.0/0"
echo "Poi rilancia lo stesso comando. Registri: sudo journalctl -u blockstrike-caddy -u blockstrike-game -n 50"
exit 1
