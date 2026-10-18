"""Splice a music bed from beat-aligned slices of one track, and record its beat grid.

    python -I bed.py <beats.json> <track.mp3> <out.mp3> <start_s> A-B [C-D ...]

Slices are beat indexes counted from the first beat at/after start_s (A inclusive, B
exclusive). E.g. `18.53 0-29 0-16` = the 29 beats from 18.53 s, then its first 16 again:
use it when the window you want runs into a long quiet break, or to end on a quiet bit
that loops back into the drop. Adds "<out stem>" to beats.json with the new grid.
Joins get 4 ms fades (no clicks). Needs ffmpeg.
"""
import json
import subprocess
import sys
from pathlib import Path

beats_json, track, out, start, *spans = sys.argv[1:]
B = json.loads(Path(beats_json).read_text())
bs = [b for b in B[Path(track).stem]["beats"] if b >= float(start) - 0.02]
grid, filt, off = [], [], 0.0
for i, span in enumerate(spans):
    a, b = (int(x) for x in span.split("-"))
    t0, t1 = bs[a], bs[b]
    grid += [off + (x - t0) for x in bs[a:b]]
    filt.append(f"[0:a]atrim={t0}:{t1},asetpts=PTS-STARTPTS,afade=t=in:d=0.004,afade=t=out:st={t1 - t0 - 0.004}:d=0.004[p{i}]")
    off += t1 - t0
grid.append(off)
fc = ";".join(filt) + ";" + "".join(f"[p{i}]" for i in range(len(spans))) + f"concat=n={len(spans)}:v=0:a=1[out]"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", track, "-filter_complex", fc, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "320k", out], check=True)
B[Path(out).stem] = {"tempo": B[Path(track).stem]["tempo"], "beats": [round(x, 4) for x in grid]}
Path(beats_json).write_text(json.dumps(B))
print(f"{out}: {off:.2f} s, {len(grid) - 1} beats")
