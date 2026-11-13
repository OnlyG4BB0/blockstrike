#!/usr/bin/env bash
# Installa (o aggiorna) il server di BLOCKSTRIKE sulla VPS, accanto a quello che c'è già.
#
#   curl -fsSL https://raw.githubusercontent.com/OnlyG4BB0/blockstrike/main/deploy/vps/install.sh | bash -s -- <IP pubblico>
#
# Cosa fa: Docker se manca, il codice in ~/blockstrike, due container (blockstrike-game e
# blockstrike-caddy) e due regole del firewall per le porte 80 e 443.
# Cosa NON fa: non ferma, non cancella e non riconfigura altri container o servizi (per esempio
# bobertbot). Se le porte 80 o 443 sono già usate da altro, si ferma prima di cambiare qualcosa.
set -euo pipefail

IP="${1:-}"
if ! [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "Uso: install.sh <IP pubblico della VPS>   (lo trovi nella console Oracle, nella pagina dell'istanza)"
  exit 1
fi
DOMAIN="${IP//./-}.sslip.io"
REPO="${BLOCKSTRIKE_REPO:-https://github.com/OnlyG4BB0/blockstrike.git}"
DIR="${BLOCKSTRIKE_DIR:-$HOME/blockstrike}"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

ours_running() { $SUDO docker ps --format '{{.Names}}' 2>/dev/null | grep -qx blockstrike-caddy; }

echo "== 1. Porte 80 e 443"
for port in 80 443; do
  if $SUDO ss -ltnH "sport = :$port" | grep -q . && ! ours_running; then
    echo "La porta $port è già usata da un altro programma: mi fermo senza cambiare niente."
    $SUDO ss -ltnp "sport = :$port" || true
    echo "Scrivimi cosa c'è su quella porta: si può usare un'altra strada senza toccarlo."
    exit 1
  fi
done
echo "libere (o già di BLOCKSTRIKE)"

echo "== 2. Programmi necessari"
if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then $SUDO apt-get update -q && $SUDO apt-get install -y -q git
  else $SUDO dnf install -y -q git; fi
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker non c'è: lo installo con lo script ufficiale (get.docker.com)."
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO docker compose version >/dev/null 2>&1 || { echo "Manca il plugin 'docker compose': installalo e rilancia."; exit 1; }

echo "== 3. Firewall della macchina (Oracle chiude le porte anche dentro la VPS): apro solo 80 e 443"
if command -v firewall-cmd >/dev/null 2>&1 && $SUDO firewall-cmd --state >/dev/null 2>&1; then
  $SUDO firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
  $SUDO firewall-cmd --reload >/dev/null
elif command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    $SUDO iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
      || $SUDO iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then $SUDO netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

echo "== 4. Codice in $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only -q; else git clone -q --depth 1 "$REPO" "$DIR"; fi

echo "== 5. Avvio (solo i container blockstrike-game e blockstrike-caddy)"
cd "$DIR/deploy/vps"
printf 'DOMAIN=%s\n' "$DOMAIN" > .env
$SUDO docker compose up -d --build

echo "== 6. Attendo il certificato per $DOMAIN"
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
echo "  Networking → Virtual Cloud Network → Security List → Ingress: TCP 80 e 443 da 0.0.0.0/0"
echo "Poi rilancia lo stesso comando. Registro di Caddy: $SUDO docker logs blockstrike-caddy"
exit 1
