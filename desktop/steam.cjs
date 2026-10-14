// Optional thin Steam layer. The web build never needs this; the desktop build uses it only when
// steamworks.js is installed and the game is launched through Steam (steam_appid.txt present).
let client = null;
module.exports = {
  init() {
    try {
      const sw = require('steamworks.js');
      client = sw.init();
      console.log('[steam] signed in as', client.localplayer.getName());
    } catch { client = null; }
  },
  unlockAchievement(id) { try { return client ? client.achievement.activate(String(id)) : false; } catch { return false; } },
  shutdown() { client = null; },
};
