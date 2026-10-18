"""Beat grid + loudness per beat for music tracks, for cutting reels on the beat.

    python -I beats.py <out beats.json> <track.mp3> [<track.mp3> ...] [--bpm 129,144,...]
    python -I beats.py --show <beats.json> <track name> <start s> [count]

Writes {name: {tempo, beats: [s, ...]}} (name = file stem). --show prints, from `start`,
each beat as index:time-from-start:loudness(0-9), so you can see drops (high) and breaks
(low) and pick a window: a ~20 s reel wants a strong first beat and, for a clean loop,
a quieter stretch at the end that leads back into the start.

Needs librosa (pip install librosa in a venv).
"""
import json
import sys
from pathlib import Path

import numpy as np


def grid(paths, bpms):
    import librosa

    out = {}
    for i, p in enumerate(paths):
        y, sr = librosa.load(p, sr=22050, mono=True)
        kw = {"bpm": bpms[i], "tightness": 400} if i < len(bpms) and bpms[i] else {}
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time", **kw)
        out[Path(p).stem] = {"tempo": float(np.atleast_1d(tempo)[0]), "beats": [round(float(b), 3) for b in beats]}
        print(f"{Path(p).stem}: {out[Path(p).stem]['tempo']:.1f} BPM, {len(beats)} beats")
    return out


def show(beats_json, name, start, count, music_dir=None):
    import librosa

    d = json.loads(Path(beats_json).read_text())[name]
    src = next(Path(music_dir or Path(beats_json).parent).glob(f"**/{name}.*"), None)
    bs = [b for b in d["beats"] if b >= start - 0.02][:count]
    loud = [0] * len(bs)
    if src:
        y, sr = librosa.load(str(src), sr=22050)
        rms = librosa.feature.rms(y=y, hop_length=512)[0]
        t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=512)
        loud = [int(9 * np.interp(b + 0.05, t, rms) / rms.max()) for b in bs]
    print(" ".join(f"{i}:{b - bs[0]:.2f}:{v}" for i, (b, v) in enumerate(zip(bs, loud))))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "--show":
        show(a[1], a[2], float(a[3]), int(a[4]) if len(a) > 4 else 48)
    else:
        bpms = []
        if "--bpm" in a:
            i = a.index("--bpm")
            bpms = [float(x) if x else 0 for x in a[i + 1].split(",")]
            a = a[:i] + a[i + 2 :]
        res = grid(a[1:], bpms)
        p = Path(a[0])
        old = json.loads(p.read_text()) if p.exists() else {}
        old.update(res)
        p.write_text(json.dumps(old))
