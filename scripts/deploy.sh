#!/bin/sh
# Build the app and publish it to a locally running static service, then check that the
# service serves the new build. Run from the project root: npm run deploy
#
# Configuration, from the environment or an untracked .env.deploy file:
#   APEX_PUBLIC_URL   HTTPS address the service is reachable at, for example
#                     https://my-host.my-tailnet.ts.net:5173 (required)
#   APEX_RUNTIME      folder that holds the service, default
#                     "$HOME/Library/Application Support/ApexStudio"
#   APEX_LABEL        macOS LaunchAgent label, default local.apex.racechrono
set -eu
[ -f .env.deploy ] && . ./.env.deploy
: "${APEX_PUBLIC_URL:?Set APEX_PUBLIC_URL, for example in .env.deploy}"
RUNTIME="${APEX_RUNTIME:-$HOME/Library/Application Support/ApexStudio}"
LABEL="${APEX_LABEL:-local.apex.racechrono}"
URL="http://127.0.0.1:5180"
PUBLIC="$APEX_PUBLIC_URL"

npm run build
# Only the production build goes out; private fixtures never live in dist/.
rsync -a --delete dist/ "$RUNTIME/web/"
cp scripts/serve.mjs "$RUNTIME/serve.mjs"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

# Tailscale terminates HTTPS and proxies to the loopback server. Set it up once with:
#   tailscale serve --bg --https=<port> http://127.0.0.1:5180
tailscale serve status 2>/dev/null | grep -qF "${PUBLIC#https://}" || {
  echo "No Tailscale Serve mapping for $PUBLIC. Run: tailscale serve --bg --https=<port> http://127.0.0.1:5180" >&2
  exit 1
}
built=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html)
check() {
  for i in 1 2 3 4 5 6 7 8 9 10; do
    served=$(curl -fs -m 5 "$1/" 2>/dev/null | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' || true)
    [ -n "$served" ] && break
    sleep 1
  done
  if [ "$served" != "$built" ]; then
    echo "Deploy check failed at $1: serves '$served', build is '$built'" >&2
    exit 1
  fi
}
check "$URL"
check "$PUBLIC"
echo "Deployed $built. Served at $PUBLIC/"
