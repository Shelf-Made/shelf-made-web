# Reels

Short vertical promo videos cut from real gameplay. Output goes to `media/reels/`.

1. **Serve a production build** (a dev server's hot reload kills takes):
   `npm run build && npx vite preview --port 4173`
2. **Capture**: shots are listed in `reels/shots.json` (`{ name, scene, seconds, tail }`);
   each `scene` is defined in `reels/capture/director.js` (setup, scripted actions, portrait
   camera, and the cue that marks its money moment). The director steps the game one 1/30 s
   frame at a time, paints the floating "+$" popups into the frame and records the game's
   sound cues, rendered offline in sync (`AudioEngine.attach`).
   `OUT=reels/out JOBS=3 GAME_URL=http://127.0.0.1:4173/ reels/capture/batch.sh [names…]`
   (about 2–5 s per frame in headless software WebGL). Check a take with
   `reels/inspect.sh reels/out/<take>.mp4 0 99 2`.
3. **Stage** good takes: copy them to `reels/final/`, then `reels/stage.sh reels/final`.
4. **Edit** timelines in `reels/edit/src/reels.ts` (cuts in beats of the measured grid in
   `src/beats.json`, from `beats.py`). `cd reels/edit && npx tsc --noEmit && npx remotion compositions`.
5. **Render**: `reels/render.sh` → every reel, its `-game-sound` twin and the covers, mastered
   to −14 LUFS.

Music: `reels/edit/public/music/CREDITS.md` (CC BY 4.0, credit required).
