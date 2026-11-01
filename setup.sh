#!/usr/bin/env bash
# Machine setup: ollama + model alias, kokoro tts server, whisper, redis, postgres, npm deps. Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$PATH"

step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local reply; read -rp "$1 [y/N] " reply || true; [[ $reply =~ ^[Yy] ]]; }
has() { command -v "$1" >/dev/null 2>&1; }
env_get() { grep -m1 "^$1=" .env | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' || true; }
need() { for k; do [[ -n ${!k} ]] || die "$k is not set in .env"; done; }
wait_for() { for _ in $(seq "$2"); do curl -sf "$1" >/dev/null && return 0; sleep 1; done; return 1; }
tagged() { [[ $1 == *:* ]] && echo "$1" || echo "$1:latest"; }

APT_UPDATED=
apt_install() {
  [[ -n $APT_UPDATED ]] || { sudo apt-get update; APT_UPDATED=1; }
  sudo apt-get install -y "$@"
}

[[ -f .env ]] || { cp .env.development .env; echo "created .env from .env.development - fill in the secrets"; }

step "System tools"
missing=()  
for t in curl git ffmpeg; do has "$t" || missing+=("$t"); done
((${#missing[@]})) && apt_install "${missing[@]}"
ok "curl, git, ffmpeg"

step "Ollama"
OLLAMA_URL=$(env_get OLLAMA_URL)
OLLAMA_MODEL=$(env_get OLLAMA_MODEL)
OLLAMA_SOURCE_MODEL=$(env_get OLLAMA_SOURCE_MODEL)
need OLLAMA_URL OLLAMA_MODEL OLLAMA_SOURCE_MODEL
has ollama || curl -fsSL https://ollama.com/install.sh | sh
if ! curl -sf "$OLLAMA_URL/api/tags" >/dev/null; then
  if systemctl cat ollama >/dev/null 2>&1; then sudo systemctl enable --now ollama
  else setsid ollama serve </dev/null >/dev/null 2>&1 &
  fi
  wait_for "$OLLAMA_URL/api/tags" 30 || die "ollama did not start on $OLLAMA_URL"
fi
models=$(ollama list | awk 'NR > 1 { print $1 }')
if ! grep -qxF "$(tagged "$OLLAMA_MODEL")" <<<"$models"; then
  grep -qxF "$(tagged "$OLLAMA_SOURCE_MODEL")" <<<"$models" || ollama pull "$OLLAMA_SOURCE_MODEL"
  ollama cp "$OLLAMA_SOURCE_MODEL" "$OLLAMA_MODEL"
fi
ok "$OLLAMA_MODEL (alias of $OLLAMA_SOURCE_MODEL)"

step "Kokoro TTS server"
KOKORO_URL=$(env_get KOKORO_URL)
KOKORO_DIR=$(env_get KOKORO_DIR)
KOKORO_REPO=$(env_get KOKORO_REPO)
need KOKORO_URL KOKORO_DIR
if [[ ! -d $KOKORO_DIR ]]; then
  [[ -n $KOKORO_REPO ]] || die "$KOKORO_DIR not found and KOKORO_REPO is empty in .env"
  git clone "$KOKORO_REPO" "$KOKORO_DIR"
fi
has uv || curl -LsSf https://astral.sh/uv/install.sh | sh
has just || curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to "$HOME/.local/bin"
if ! curl -sf "$KOKORO_URL/health" >/dev/null; then
  mkdir -p logs
  [[ -f $KOKORO_DIR/pyproject.toml ]] && (cd "$KOKORO_DIR" && uv sync)
  (cd "$KOKORO_DIR" && exec setsid just start) </dev/null >"$ROOT/logs/kokoro.log" 2>&1 &
  wait_for "$KOKORO_URL/health" 180 || die "kokoro did not come up on $KOKORO_URL - see logs/kokoro.log"
fi
ok "kokoro healthy at $KOKORO_URL"

step "Whisper"
WHISPER_BIN=$(env_get WHISPER_BIN)
WHISPER_MODEL=$(env_get WHISPER_MODEL)
need WHISPER_BIN WHISPER_MODEL
WHISPER_DIR=${WHISPER_BIN%/build/bin/whisper-cli}
if [[ ! -x $WHISPER_BIN ]]; then
  [[ $WHISPER_DIR != "$WHISPER_BIN" ]] || die "WHISPER_BIN must end in build/bin/whisper-cli"
  has cmake && has g++ || apt_install build-essential cmake
  [[ -d $WHISPER_DIR ]] || git clone https://github.com/ggml-org/whisper.cpp "$WHISPER_DIR"
  cmake -S "$WHISPER_DIR" -B "$WHISPER_DIR/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$WHISPER_DIR/build" -j --config Release --target whisper-cli
fi
if [[ ! -f $WHISPER_MODEL ]]; then
  mkdir -p "$(dirname "$WHISPER_MODEL")"
  curl -fL -o "$WHISPER_MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$(basename "$WHISPER_MODEL")"
  mv "$WHISPER_MODEL.part" "$WHISPER_MODEL"
fi
ok "$WHISPER_BIN with $(basename "$WHISPER_MODEL")"

step "Redis"
REDIS_HOST=$(env_get REDIS_HOST)
REDIS_PORT=$(env_get REDIS_PORT)
redis_ok() { redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; }
if ! redis_ok; then
  has redis-server || apt_install redis-server
  sudo systemctl enable --now redis-server
  sleep 1
  redis_ok || die "redis not answering on $REDIS_HOST:$REDIS_PORT"
fi
ok "redis on $REDIS_HOST:$REDIS_PORT"

step "Postgres"
DB_HOST=$(env_get DB_HOST)
DB_PORT=$(env_get DB_PORT)
DB_NAME=$(env_get DB_NAME)
DB_USER=$(env_get DB_USER)
DB_PASSWORD=$(env_get DB_PASSWORD)
need DB_HOST DB_PORT DB_NAME DB_USER
has psql || apt_install postgresql postgresql-contrib
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null; then
  sudo systemctl enable --now postgresql
  sleep 2
  pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null || die "postgres not answering on $DB_HOST:$DB_PORT"
fi
pg() { PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$1" -tAc 'select 1' >/dev/null 2>&1; }
pg_admin() { sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v user="$DB_USER" -v pass="$DB_PASSWORD" -v db="$DB_NAME"; }
if ! pg "$DB_NAME"; then
  [[ $DB_HOST =~ ^(localhost|127\.0\.0\.1)$ ]] || die "can't connect to $DB_NAME on $DB_HOST - create it there and re-run"
  if ! pg postgres; then
    ask "Can't log in to Postgres as '$DB_USER'. Create the role / set its password from .env?" || die "fix DB_USER/DB_PASSWORD in .env"
    pg_admin <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'user') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'user', :'pass') \gexec
SQL
  fi
  if ! pg "$DB_NAME"; then
    ask "Database '$DB_NAME' does not exist. Create it?" || die "create database '$DB_NAME' and re-run"
    pg_admin <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user') \gexec
SQL
  fi
fi
ok "postgres database $DB_NAME as $DB_USER"

step "npm dependencies"
npm install
ok "done - run 'npm run migrate' on a fresh database, then 'npm start'"
