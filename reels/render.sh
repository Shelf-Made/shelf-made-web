#!/usr/bin/env bash
# Renders the reels (and their game-sound-only versions) and covers into media/reels/.
#   reels/render.sh [CompositionId ...]     (default: every reel, its game-sound version and every cover)
# Footage must be in reels/edit/public/footage (reels/capture/batch.sh, then copy).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="${DEST:-$here/../media/reels}"
tmp="$here/out"
mkdir -p "$dest" "$tmp"
cd "$here/edit"
ids=("$@")
if [ ${#ids[@]} -eq 0 ]; then
  mapfile -t ids < <(npx remotion compositions --quiet 2>/dev/null | tr ' ' '\n' | grep -E '^(Reel|Cover)[0-9]+' || true)
fi
for id in "${ids[@]}"; do
  case "$id" in
    Cover*)
      npx remotion still "$id" "$dest/$id.jpg" --image-format=jpeg --jpeg-quality=92
      ;;
    *)
      npx remotion render "$id" "$tmp/$id.mp4" --crf=16 --concurrency="${CONCURRENCY:-2}"
      # Instagram plays reels at about -14 LUFS: master to that, peaks under -1.5 dBTP.
      # (Game sound alone is all spikes: even it out first, or the peak limit holds it down.)
      af="loudnorm=I=-14:TP=-1.5:LRA=11"
      case "$id" in *-game-sound) af="acompressor=threshold=-26dB:ratio=4:attack=4:release=90:makeup=2,$af" ;; esac
      ffmpeg -y -loglevel error -i "$tmp/$id.mp4" -c:v copy -af "$af" -ar 48000 -c:a aac -b:a 192k -movflags +faststart "$dest/$id.mp4"
      ;;
  esac
  echo "-> $dest/$id"
done
