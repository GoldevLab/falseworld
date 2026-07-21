#!/usr/bin/env bash
# Deploy False World to Fly.io.
# Builds a small staging context with falseworld + local resuma (path dep).
set -euo pipefail

APP="${FLY_APP:-falseworld}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS="$(cd "$ROOT/.." && pwd)"
CTX="$ROOT/.fly-context"

# Local installs expose `fly`; GitHub Actions setup-flyctl exposes `flyctl`.
if command -v fly >/dev/null 2>&1; then
  FLY=(fly)
elif command -v flyctl >/dev/null 2>&1; then
  FLY=(flyctl)
else
  echo "Instala flyctl: https://fly.io/docs/hands-on/install-flyctl/"
  exit 1
fi

if ! "${FLY[@]}" auth whoami >/dev/null 2>&1; then
  echo "Ejecuta: fly auth login (o define FLY_API_TOKEN)"
  exit 1
fi

if [[ ! -d "$APPS/resuma/crates/resuma" ]]; then
  echo "Falta $APPS/resuma (path dependency de falseworld)."
  exit 1
fi

echo "==> Staging context en $CTX"
rm -rf "$CTX"
mkdir -p "$CTX/falseworld" "$CTX/resuma/crates"

rsync -a --delete \
  --exclude target --exclude .resuma --exclude .fly-context \
  --exclude '_debug*.png' --exclude 'fw-test*.png' --exclude 'shot-*.png' \
  --exclude 'crates/falseworld-wgpu/src' \
  "$ROOT/" "$CTX/falseworld/"

# Keep wgpu Cargo.toml so the workspace resolves; sources are stubbed in Docker.
mkdir -p "$CTX/falseworld/crates/falseworld-wgpu"
cp -a "$ROOT/crates/falseworld-wgpu/Cargo.toml" "$CTX/falseworld/crates/falseworld-wgpu/"

rsync -a --delete \
  --exclude target --exclude examples --exclude docs --exclude website \
  --exclude .git --exclude .github --exclude node_modules \
  "$APPS/resuma/Cargo.toml" "$APPS/resuma/Cargo.lock" "$APPS/resuma/README.md" "$CTX/resuma/" 2>/dev/null || true
cp -a "$APPS/resuma/Cargo.toml" "$CTX/resuma/"
cp -a "$APPS/resuma/Cargo.lock" "$CTX/resuma/" 2>/dev/null || true
cp -a "$APPS/resuma/README.md" "$CTX/resuma/" 2>/dev/null || true
rsync -a --delete --exclude target "$APPS/resuma/crates/resuma-macros/" "$CTX/resuma/crates/resuma-macros/"
rsync -a --delete --exclude target "$APPS/resuma/crates/resuma/" "$CTX/resuma/crates/resuma/"
rsync -a --delete "$APPS/resuma/client-sdk/" "$CTX/resuma/client-sdk/" 2>/dev/null || mkdir -p "$CTX/resuma/client-sdk"

cp -f "$ROOT/Dockerfile" "$CTX/Dockerfile"
cp -f "$ROOT/fly.toml" "$CTX/fly.toml"

echo "==> App $APP"
if ! "${FLY[@]}" status -a "$APP" >/dev/null 2>&1; then
  echo "    Creando app…"
  "${FLY[@]}" apps create "$APP" --org personal
fi

echo "==> Deploy"
cd "$CTX"
"${FLY[@]}" deploy . --config fly.toml --dockerfile Dockerfile --app "$APP" "$@"

echo ""
echo "Listo: https://${APP}.fly.dev/"
