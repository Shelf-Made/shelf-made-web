#!/usr/bin/env bash
# Films every shot in reels/shots.json (or only the names given), a few at a time.
#   OUT=reels/out JOBS=3 GAME_URL=http://localhost:5173/ reels/capture/batch.sh [name ...]
# The game must already be served from a production build (no hot reload).
# Each take's director is read when it starts: editing director.js mid-batch affects the
# takes that start afterwards only.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${OUT:-$here/../out}"
jobs="${JOBS:-3}"
mkdir -p "$out"
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
export DIRECTOR="${DIRECTOR:-$here/director.js}"
node -e '
  const shots = require(process.argv[1]);
  const want = process.argv.slice(2);
  for (const s of shots) if (!want.length || want.includes(s.name)) console.log(JSON.stringify(s));
' "$here/../shots.json" "$@" |
  # (`exit 0`: xargs stops launching new takes after one fails or is killed.)
  xargs -d '\n' -P "$jobs" -I{} sh -c 'node "$0/capture.cjs" "$1" "$2" 2>&1 | grep --line-buffered -v "GL Driver"; exit 0' "$here" {} "$out"
