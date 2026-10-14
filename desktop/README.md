# Shelf Made desktop

An Electron wrapper around the same web build. Saves go to the OS user-data folder
(`%APPDATA%/shelf-made-desktop/saves`, `~/Library/Application Support/...`, `~/.config/...`)
through the `__shelfStorage` bridge that `src/save/storage.ts` prefers when present.

```
cd desktop
npm install
npm start          # runs against ../dist (build the web app first: npm run build in the repo root)
npm run dist       # electron-builder, unpacked app in desktop/dist
```

Steam: install `steamworks.js` and drop a `steam_appid.txt` beside the executable. Without it
the Steam layer is a no-op; the web build never loads it.
