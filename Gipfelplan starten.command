#!/bin/bash
# Startet Gipfelplan lokal. Doppelklick im Finder genügt.
cd "$(dirname "$0")" || exit 1

# Node über nvm laden, falls vorhanden
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "/opt/homebrew/bin/brew" ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -s "/usr/local/bin/brew" ] && eval "$(/usr/local/bin/brew shellenv)"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js ist nicht installiert. Bitte von https://nodejs.org die LTS-Version installieren und dann erneut starten."
  read -r -p "Enter zum Schließen …"
  exit 1
fi

MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 20 ]; then
  if command -v nvm >/dev/null 2>&1; then
    echo "Node $(node -v) ist zu alt, wechsle per nvm auf Version 20 …"
    nvm install 20 >/dev/null && nvm use 20 >/dev/null
  else
    echo "Node $(node -v) ist zu alt. Gipfelplan braucht Node 20 oder neuer (https://nodejs.org)."
    read -r -p "Enter zum Schließen …"
    exit 1
  fi
fi

echo "Node $(node -v)"
if [ ! -d node_modules ]; then
  echo "Installiere Abhängigkeiten (einmalig) …"
  npm install || { read -r -p "Installation fehlgeschlagen. Enter zum Schließen …"; exit 1; }
fi

echo ""
echo "Gipfelplan läuft auf http://localhost:5173"
echo "Zum Beenden dieses Fenster schließen oder Ctrl+C drücken."
echo ""
npm run dev
