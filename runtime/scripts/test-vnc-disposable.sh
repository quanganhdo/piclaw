#!/usr/bin/env bash
# Linux-only real desktop acceptance. Never binds to or probes the host network.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
if [[ ${1:-} != --inside ]]; then
  [[ $(uname -s) == Linux && $EUID != 0 ]] || { echo 'Run as an ordinary Linux user with sudo access.' >&2; exit 1; }
  for tool in sudo unshare ip Xvfb xterm x11vnc xclip xprop bun; do command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 1; }; done
  out=${1:-"$repo/.artifacts/vnc-viewer"}
  mkdir -p "$out"; out=$(cd "$out" && pwd)
  browser_path=${PLAYWRIGHT_BROWSERS_PATH:-"$HOME/.cache/ms-playwright"}
  # Only loopback exists in the new namespace. Drop back to the invoking user before X/browser startup.
  exec sudo -n unshare --net --fork bash -c 'ip link set lo up; exec runuser -u "$1" -- "$2" --inside "$3" "$4" "$5"' bash "$(id -un)" "$repo/runtime/scripts/test-vnc-disposable.sh" "$out" "$browser_path" "$(dirname "$(command -v bun)")"
fi
[[ $(readlink /proc/self/ns/net) != $(readlink /proc/1/ns/net) ]] || { echo 'Refusing host network namespace.' >&2; exit 1; }
export PATH="$4:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$3"
export VNC_FIXTURE_OUTPUT_DIR="$2"
fixture=$(mktemp -d)
cleanup() {
  for pid in ${auth_vnc:-} ${vnc:-} ${term:-} ${xvfb:-}; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  cp "$fixture/x11vnc.log" "$VNC_FIXTURE_OUTPUT_DIR/x11vnc.log" 2>/dev/null || true
  rm -rf "$fixture"
}
trap cleanup EXIT
Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>"$fixture/display" >"$fixture/xvfb.log" 2>&1 & xvfb=$!
for i in $(seq 1 50); do [[ -s "$fixture/display" ]] && break; sleep .1; done
export DISPLAY=:$(cat "$fixture/display")
xterm -geometry 110x35+0+0 -fa Monospace -fs 12 -bg '#172433' -fg '#dce7ef' -e /bin/bash --noprofile --norc >"$fixture/xterm.log" 2>&1 & term=$!
sleep 1
x11vnc -display "$DISPLAY" -rfbport 5901 -localhost -forever -shared -nopw -noxdamage >"$fixture/x11vnc.log" 2>&1 & vnc=$!
# Disposable known test credential, not a user secret.
x11vnc -storepasswd testpass "$fixture/passwd" >/dev/null 2>&1
x11vnc -display "$DISPLAY" -rfbport 5902 -localhost -forever -shared -rfbauth "$fixture/passwd" -noxdamage >"$fixture/auth.log" 2>&1 & auth_vnc=$!
sleep 1
cd "$repo"
PICLAW_E2E_DISPOSABLE=1 PICLAW_RUN_OPTIONAL_BROWSER_TESTS=1 bun run test:local --cwd runtime -- bun test test/web/vnc-viewer.playwright.optional.test.ts 2>&1 | tee "$VNC_FIXTURE_OUTPUT_DIR/browser-tests.log"
