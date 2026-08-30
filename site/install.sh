#!/usr/bin/env bash
# Familiar — one-command install.
#   curl -fsSL https://familiar.omisaur.app/install.sh | bash
set -euo pipefail

BOLD=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; RED=$'\033[31m'; OFF=$'\033[0m'
say()  { printf "%s\n" "$1"; }
ok()   { printf "  ${GRN}✓${OFF} %s\n" "$1"; }
die()  { printf "  ${RED}✗${OFF} %s\n" "$1"; exit 1; }

say ""
say "${BOLD}Familiar${OFF} — closes the loops you drop"
say ""

[ "$(uname)" = "Darwin" ] || die "Familiar is macOS only for now."

command -v git >/dev/null || die "git is required."
command -v node >/dev/null || die "Node.js 22+ is required: https://nodejs.org"
MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$MAJOR" -ge 22 ] || die "Node 22+ is required (you have $(node -v)): https://nodejs.org"
ok "node $(node -v)"

DIR="${FAMILIAR_DIR:-$HOME/familiar}"
if [ -d "$DIR/.git" ]; then
  say "  updating $DIR"
  git -C "$DIR" pull --quiet --ff-only 2>/dev/null || true
else
  say "  cloning into $DIR"
  git clone --quiet --branch main https://github.com/ombhojane/familiar "$DIR"
fi
ok "source in $DIR"

cd "$DIR"
say "  installing dependencies (a minute or so)"
npm install --silent >/dev/null 2>&1 || npm install >/dev/null
ok "dependencies"

if [ ! -f .env ]; then
  cp .env.example .env
  say ""
  say "${BOLD}One thing needed:${OFF} an OpenAI key."
  say "${DIM}  Familiar reads your screen with a model. ~\$0.0003 per capture.${OFF}"
  say "${DIM}  Get one at https://platform.openai.com/api-keys${OFF}"
  say ""
  printf "  Paste it here (input hidden): "
  read -rs KEY; say ""
  [ -n "$KEY" ] || die "No key entered. Add OPENAI_API_KEY to $DIR/.env and run ./scripts/dev.sh"
  # macOS sed needs the empty -i argument
  /usr/bin/sed -i '' "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$KEY|" .env
  ok "key saved to .env (stays on this machine)"
else
  ok ".env already present, leaving it alone"
fi

say ""
say "  starting everything…"
./scripts/dev.sh

say ""
say "  ${BOLD}Press ⌃⌥⌘H over anything unfinished.${OFF}"
say "  ${DIM}macOS will ask for Screen Recording the first time. Stop with ./scripts/dev.sh stop${OFF}"
say ""
