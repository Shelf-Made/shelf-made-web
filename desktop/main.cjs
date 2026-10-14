// Shelf Made desktop wrapper. The web build is loaded from ../dist; saves live in the OS user-data folder.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const steam = require('./steam.cjs');

const saveDir = () => path.join(app.getPath('userData'), 'saves');
const safe = (key) => key.replace(/[^a-z0-9:_-]/gi, '_') + '.json';

ipcMain.handle('storage:get', async (_e, key) => { try { return await fs.readFile(path.join(saveDir(), safe(key)), 'utf8'); } catch { return null; } });
ipcMain.handle('storage:set', async (_e, key, value) => { await fs.mkdir(saveDir(), { recursive: true }); await fs.writeFile(path.join(saveDir(), safe(key)), value, 'utf8'); });
ipcMain.handle('storage:delete', async (_e, key) => { try { await fs.unlink(path.join(saveDir(), safe(key))); } catch { /* already gone */ } });
ipcMain.handle('storage:keys', async () => { try { return (await fs.readdir(saveDir())).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; } });
ipcMain.handle('steam:unlock', async (_e, id) => steam.unlockAchievement(id));

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 960, minHeight: 600, backgroundColor: '#BFE3FF', title: 'Shelf Made',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => { steam.init(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { steam.shutdown(); if (process.platform !== 'darwin') app.quit(); });
