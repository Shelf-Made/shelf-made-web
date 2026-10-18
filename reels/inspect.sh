#!/usr/bin/env bash
# Contact sheet of a take, with timestamps, plus its key sounds and moments: look at every
# take before editing (camera blocked? KO landed? where's the money shot?).
#   inspect.sh <take.mp4> [from_s] [to_s] [fps]      -> <take>.sheet.jpg next to it
set -euo pipefail
v=$1; a=${2:-0}; b=${3:-999}; r=${4:-2}
base="${v%.mp4}"
ffmpeg -loglevel error -y -ss "$a" -to "$b" -i "$v" \
  -vf "fps=$r,scale=216:-1,drawtext=text='%{pts\:hms}':x=4:y=4:fontsize=20:fontcolor=yellow:box=1:boxcolor=black,tile=8x3" \
  -frames:v 1 "$base.sheet.jpg"
echo "sheet: $base.sheet.jpg  (timestamps are relative to $a s)"
[ -f "$base.json" ] && node -e '
  const d = require(process.argv[1]);
  console.log(`length ${d.seconds.toFixed(2)}s  KO ${d.koAt}`);
  for (const m of d.marks) console.log(`  ${m.t.toFixed(2)}  ${m.kind}  ${m.label ?? ""}`);
' "$(realpath "$base.json")" || true
