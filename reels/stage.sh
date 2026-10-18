#!/usr/bin/env bash
# Copies captured takes into the edit (public/footage) and indexes their moments
# (KO time, length, marks) into src/takes.json for the timelines.
#   reels/stage.sh <footage dir>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="${1:-$here/out}"
mkdir -p "$here/edit/public/footage"
cp "$src"/*.mp4 "$src"/*.wav "$here/edit/public/footage/"
node -e '
  const fs = require("fs"), path = require("path");
  const [src, out] = process.argv.slice(1);
  const takes = {};
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".json")).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(src, f)));
    takes[d.shot.name] = { seconds: +d.seconds.toFixed(3), ko: d.koAt, marks: d.marks.map((m) => ({ t: +m.t.toFixed(3), kind: m.kind, label: m.label })) };
  }
  fs.writeFileSync(out, JSON.stringify(takes, null, 1));
  console.log(Object.entries(takes).map(([k, v]) => `${k}: ${v.seconds}s ko ${v.ko}`).join("\n"));
' "$src" "$here/edit/src/takes.json"
