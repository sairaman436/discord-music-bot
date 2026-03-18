const express = require('express');
const path = require('path');
const app = express();

const CLIENT_ID = process.env.CLIENT_ID || '1481664584619397275';
const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3000;

// ─── Bot invite URL (needs Send Messages, Connect, Speak, Use Slash Commands)
const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=3147776&scope=bot%20applications.commands`;

// ─── Serve static assets
app.use('/assets', express.static(path.join(__dirname, 'public')));

// ─── Landing page
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── API: bot info (for dynamic stats in the page)
app.get('/api/info', (_req, res) => {
  try {
    const MusicPlayer = require('../music-player');
    const client = global.botClient;

    res.json({
      name: client?.user?.username ?? 'Zupp Music',
      avatar: client?.user?.displayAvatarURL({ size: 256 }) ?? '',
      servers: client?.guilds?.cache?.size ?? '?',
      playing: MusicPlayer.activeCount(),
      status: client?.isReady() ? 'online' : 'offline',
      inviteUrl: INVITE_URL,
    });
  } catch (err) {
    console.warn('[Dashboard API] Failed to get bot info:', err.message);
    res.json({
      name: 'Zupp Music',
      servers: '?',
      playing: 0,
      status: 'loading',
      inviteUrl: INVITE_URL,
    });
  }
});

// ─── Invite redirect
app.get('/invite', (_req, res) => res.redirect(INVITE_URL));

function startDashboard() {
  // Start the dashboard after a short delay to ensure the bot is ready
  setTimeout(() => {
    app.listen(PORT, () => {
      console.log(`🌐 Dashboard running at http://localhost:${PORT}`);
    });
  }, 5000);
}

module.exports = { startDashboard };
