require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const spotify = require('./spotify-client');
const MusicPlayer = require('./music-player');
const logger = require('./utils/logger');
const { Client: Genius } = require('genius-lyrics');

// ─── Persistent Storage Paths ─────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(FAVORITES_FILE)) fs.writeFileSync(FAVORITES_FILE, '{}');

// Sleep timer handles per guild
const sleepTimers = new Map();
// Active quiz sessions per guild
const quizSessions = new Map();
// Auto-leave timers per guild
const autoLeaveTimers = new Map();

// ─── Client Setup ─────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const genius = new Genius();

// ─── Ready ────────────────────────────────────────────────────────────────────

const play = require('play-dl');

client.once('ready', async () => {
  logger.info(`✅ Online as ${client.user.tag}`);
  logger.info(`📊 Connected to ${client.guilds.cache.size} servers`);
  logger.info('🎵 Audio engine: Spotify search + SoundCloud streaming (no Lavalink)');

  try {
    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });
    logger.info('☁️  SoundCloud API client ID configured');
  } catch (err) {
    logger.error('❌ Failed to set SoundCloud client ID:', err.message);
  }
});

// ─── Auto-Leave Handler ───────────────────────────────────────────────────────

client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = oldState.guild.id;
  const botChannel = oldState.guild.members.me?.voice.channel;
  if (!botChannel) return; // Bot is not in a voice channel

  // If the affected channel is not the bot's channel, ignore
  if (oldState.channel?.id !== botChannel.id && newState.channel?.id !== botChannel.id) return;

  const nonBotMembers = botChannel.members.filter(m => !m.user.bot).size;

  if (nonBotMembers === 0) {
    if (!autoLeaveTimers.has(guildId)) {
      const timer = setTimeout(() => {
        // Double check before leaving
        const currentBotChannel = oldState.guild.members.me?.voice.channel;
        if (!currentBotChannel) return; // Left manually?

        const currentNonBots = currentBotChannel.members.filter(m => !m.user.bot).size;
        if (currentNonBots === 0) {
          logger.info(`[Auto-Leave] Leaving empty voice channel in guild ${guildId}`);
          const player = MusicPlayer.get(guildId);
          if (player) {
            player.destroy();
          } else {
            const { getVoiceConnection } = require('@discordjs/voice');
            const conn = getVoiceConnection(guildId);
            if (conn) conn.destroy();
          }
        }
        autoLeaveTimers.delete(guildId);
      }, 30_000); // 30 seconds
      autoLeaveTimers.set(guildId, timer);
    }
  } else {
    // Someone joined back or is still there
    if (autoLeaveTimers.has(guildId)) {
      clearTimeout(autoLeaveTimers.get(guildId));
      autoLeaveTimers.delete(guildId);
    }
  }
});

// ─── Slash Command Handler ────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const handlers = {
    play: cmdPlay,
    skip: cmdSkip,
    stop: cmdStop,
    queue: cmdQueue,
    pause: cmdPause,
    resume: cmdResume,
    np: cmdNowPlaying,
    volume: cmdVolume,
    shuffle: cmdShuffle,
    loop: cmdLoop,
    lyrics: cmdLyrics,
    recommend: cmdRecommend,
    '247': cmd247,
    favorite: cmdFavorite,
    sleeptimer: cmdSleepTimer,
    quiz: cmdQuiz,
  };

  const handler = handlers[interaction.commandName];
  if (!handler) return;

  // Defer early to prevent "Unknown Interaction" errors
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }
  } catch (err) {
    console.warn(`[Interaction] Failed to defer: ${err.message}`);
    return;
  }

  try {
    await handler(interaction);
  } catch (err) {
    console.error(`[/${interaction.commandName}] Command Error:`, err);
  }
});

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdPlay(interaction) {
  const vc = interaction.member?.voice?.channel;
  if (!vc) {
    return interaction.editReply({ content: '❌ Join a voice channel first!' });
  }

  const query = interaction.options.getString('query');

  // 1) Resolve track from Spotify
  let track;
  try {
    if (spotify.isSpotifyUrl(query)) {
      // Direct Spotify URL
      track = await spotify.getTrackByUrl(query);
      if (!track) {
        return interaction.editReply('❌ Could not resolve that Spotify link.');
      }
    } else {
      // Search Spotify
      const results = await spotify.searchTracks(query, 1);
      if (!results.length) {
        return interaction.editReply('❌ No results found on Spotify.');
      }
      track = results[0];
    }
  } catch (err) {
    console.error('[Play — Spotify Error]', err);
    return interaction.editReply('❌ Spotify search failed. Check your API credentials.');
  }

  // 2) Attach requester info
  track.requester = interaction.user.id;

  // 3) Get or create the guild player
  const player = MusicPlayer.getOrCreate(
    interaction.guild,
    vc,
    interaction.channel.id,
    client
  );

  // 4) Wire up events (only once per player)
  wirePlayerEvents(player);

  // 5) Add to queue & start playing if idle
  player.addTrack(track);

  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('✅ Added to Queue')
    .setDescription(`**[${track.title}](${track.uri})** — ${track.artist}`)
    .setThumbnail(track.thumbnail);

  await interaction.editReply({ embeds: [embed] }).catch(() => { });

  if (!player.playing && !player.paused) {
    player.playNext();
  }
}

async function cmdSkip(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player) return interaction.editReply({ content: '❌ Nothing is playing.' });

  player.skip();
  interaction.editReply('⏭️ Skipped!');
}

async function cmdStop(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player) return interaction.editReply({ content: '❌ Nothing is playing.' });

  player.stop();
  player.destroy();
  interaction.editReply('⏹️ Stopped and disconnected.');
}

async function cmdQueue(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player || !player.current) {
    return interaction.editReply({ content: '📭 Queue is empty.' });
  }

  const list = player.queue
    .map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`)
    .join('\n')
    .slice(0, 1800);

  const loopStatus = player.loopTrack
    ? '🔁 Track Loop'
    : player.loopQueue
      ? '🔁 Queue Loop'
      : '▶️ No Loop';

  interaction.editReply(
    `🎶 **Queue — ${player.queue.length} song(s)**\n**Now Playing:** ${player.current.title}\n\n${list || '(empty)'}\n\n${loopStatus}`
  );
}

async function cmdPause(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player) return interaction.editReply({ content: '❌ Nothing is playing.' });

  player.pause();
  interaction.editReply('⏸️ Paused.');
}

async function cmdResume(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player) return interaction.editReply({ content: '❌ Nothing is playing.' });

  player.resume();
  interaction.editReply('▶️ Resumed.');
}

async function cmdNowPlaying(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player || !player.current) {
    return interaction.editReply({ content: '❌ Nothing is playing.' });
  }

  const t = player.current;
  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setAuthor({ name: '🎵 Now Playing' })
    .setTitle(t.title)
    .setURL(t.uri)
    .setDescription(
      `**${t.artist}**\n\`${formatDuration(t.duration)}\` | Requested by <@${t.requester}>`
    )
    .setThumbnail(t.thumbnail);
  interaction.editReply({ embeds: [embed] });
}

async function cmdVolume(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player) return interaction.editReply({ content: '❌ Nothing is playing.' });

  const level = interaction.options.getInteger('level');
  player.setVolume(level);
  interaction.editReply(`🔊 Volume set to **${level}%**`);
}

async function cmdShuffle(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player || player.queue.length < 2) {
    return interaction.editReply({
      content: '❌ Need at least 2 songs in the queue to shuffle.',
    });
  }

  player.shuffle();
  interaction.editReply('🔀 Shuffled the queue!');
}

async function cmdLoop(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  if (!player) return interaction.editReply({ content: '❌ Nothing is playing.' });

  const mode = interaction.options.getString('mode') || 'track';
  if (mode === 'track') {
    player.loopTrack = !player.loopTrack;
    player.loopQueue = false;
  } else {
    player.loopQueue = !player.loopQueue;
    player.loopTrack = false;
  }

  const state = mode === 'track' ? player.loopTrack : player.loopQueue;
  interaction.editReply(`🔁 Loop **${mode}** is now **${state ? 'ON' : 'OFF'}**.`);
}

async function cmdLyrics(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  const query =
    interaction.options.getString('song') || player?.current?.title;

  if (!query) {
    return interaction.editReply('❌ Provide a song name or play something first.');
  }

  try {
    const searches = await genius.songs.search(query);
    if (!searches.length)
      return interaction.editReply(`❌ No lyrics found for **${query}**.`);

    const song = searches[0];
    const lyrics = await song.lyrics();
    const chunks = lyrics.match(/[\s\S]{1,1500}/g) || [];
    const header = `📋 **${song.title}** by **${song.artist.name}**\n\n`;

    await interaction.editReply(`${header}${chunks[0] ?? 'No lyrics found.'}`);

    for (let i = 1; i < Math.min(chunks.length, 4); i++) {
      await interaction.followUp(chunks[i]);
    }
    if (chunks.length > 4) {
      await interaction.followUp(
        '*...lyrics truncated. Full lyrics at [Genius.com](https://genius.com)*'
      );
    }
  } catch (err) {
    console.error('[Lyrics]', err);
    interaction.editReply('❌ Could not fetch lyrics.');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ✨ SPECIAL FEATURES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ──── /recommend ─ Spotify AI-powered recommendations ─────────────────────────

async function cmdRecommend(interaction) {
  const player = MusicPlayer.get(interaction.guild.id);
  const count = interaction.options.getInteger('count') || 5;

  // Need at least one track to seed recommendations
  if (!player?.current) {
    return interaction.editReply('❌ Play something first so I can recommend similar tracks!');
  }

  const seedId = player.current.spotifyId;
  if (!seedId) {
    return interaction.editReply('❌ Current track has no Spotify ID — try playing a Spotify track first.');
  }

  try {
    const recs = await spotify.getRecommendations([seedId], count);
    if (!recs.length) {
      return interaction.editReply('😕 Spotify returned no recommendations. Try a different song.');
    }

    // Add all recommended tracks to queue
    const vc = interaction.member?.voice?.channel;
    if (!vc) return interaction.editReply('❌ Join a voice channel first!');

    const p = MusicPlayer.getOrCreate(interaction.guild, vc, interaction.channel.id, client);
    wirePlayerEvents(p);

    for (const t of recs) {
      t.requester = interaction.user.id;
      p.addTrack(t);
    }
    if (!p.playing && !p.paused) p.playNext();

    const list = recs.map((t, i) => `${i + 1}. **${t.title}** — ${t.artist}`).join('\n');
    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setAuthor({ name: '🤖 AI Recommendations' })
      .setTitle(`Based on: ${player.current.title}`)
      .setDescription(`Added ${recs.length} tracks to queue:\n\n${list}`)
      .setThumbnail(player.current.thumbnail);

    return interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('[Recommend]', err);
    return interaction.editReply('❌ Failed to fetch recommendations.');
  }
}

// ──── /247 ─ Stay in the voice channel 24/7 ───────────────────────────────────

async function cmd247(interaction) {
  const vc = interaction.member?.voice?.channel;
  if (!vc) return interaction.editReply('❌ Join a voice channel first!');

  const player = MusicPlayer.getOrCreate(interaction.guild, vc, interaction.channel.id, client);
  wirePlayerEvents(player);

  player.mode247 = !player.mode247;

  if (player.mode247) {
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🌙 24/7 Mode — ON')
      .setDescription('I\'ll stay in the voice channel even when the queue is empty.\nUse `/stop` or `/247` again to disable.');
    return interaction.editReply({ embeds: [embed] });
  } else {
    return interaction.editReply('☀️ 24/7 mode **disabled**. I\'ll leave when the queue ends.');
  }
}

// ──── /favorite ─ Personal song favorites ─────────────────────────────────────

async function cmdFavorite(interaction) {
  const action = interaction.options.getString('action');
  const userId = interaction.user.id;

  // Load favorites DB
  let db = {};
  try { db = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8')); } catch { db = {}; }
  if (!db[userId]) db[userId] = [];

  // ─── ADD current song ───
  if (action === 'add') {
    const player = MusicPlayer.get(interaction.guild.id);
    if (!player?.current) {
      return interaction.editReply('❌ Nothing is playing. Play a song first!');
    }
    const t = player.current;
    // Prevent duplicates
    if (db[userId].some(f => f.spotifyId === t.spotifyId)) {
      return interaction.editReply(`⚠️ **${t.title}** is already in your favorites!`);
    }
    db[userId].push({
      title: t.title,
      artist: t.artist,
      uri: t.uri,
      spotifyId: t.spotifyId,
      thumbnail: t.thumbnail,
      duration: t.duration,
      searchQuery: t.searchQuery,
      addedAt: Date.now(),
    });
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(db, null, 2));

    const embed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setTitle('❤️ Added to Favorites')
      .setDescription(`**${t.title}** — ${t.artist}`)
      .setThumbnail(t.thumbnail);
    return interaction.editReply({ embeds: [embed] });
  }

  // ─── LIST favorites ───
  if (action === 'list') {
    if (!db[userId].length) {
      return interaction.editReply('📭 You have no favorites yet! Use `/favorite add` while a song is playing.');
    }
    const list = db[userId]
      .map((f, i) => `${i + 1}. **${f.title}** — ${f.artist}`)
      .slice(0, 20)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setTitle(`❤️ ${interaction.user.username}'s Favorites`)
      .setDescription(list)
      .setFooter({ text: `${db[userId].length} songs | Use /favorite play to queue them all` });
    return interaction.editReply({ embeds: [embed] });
  }

  // ─── PLAY all favorites ───
  if (action === 'play') {
    if (!db[userId].length) {
      return interaction.editReply('📭 No favorites to play!');
    }
    const vc = interaction.member?.voice?.channel;
    if (!vc) return interaction.editReply('❌ Join a voice channel first!');

    const player = MusicPlayer.getOrCreate(interaction.guild, vc, interaction.channel.id, client);
    wirePlayerEvents(player);

    for (const fav of db[userId]) {
      fav.requester = userId;
      player.addTrack({ ...fav });
    }
    if (!player.playing && !player.paused) player.playNext();

    const embed = new EmbedBuilder()
      .setColor(0xE91E63)
      .setTitle('❤️ Playing Favorites')
      .setDescription(`Queued **${db[userId].length}** of your favorite songs!`);
    return interaction.editReply({ embeds: [embed] });
  }

  // ─── REMOVE by number ───
  if (action === 'remove') {
    const num = interaction.options.getInteger('number');
    if (!num || num < 1 || num > db[userId].length) {
      return interaction.editReply(`❌ Invalid number. You have ${db[userId].length} favorites.`);
    }
    const removed = db[userId].splice(num - 1, 1)[0];
    fs.writeFileSync(FAVORITES_FILE, JSON.stringify(db, null, 2));
    return interaction.editReply(`🗑️ Removed **${removed.title}** from favorites.`);
  }
}

// ──── /sleeptimer ─ Auto-stop after X minutes ─────────────────────────────────

async function cmdSleepTimer(interaction) {
  const minutes = interaction.options.getInteger('minutes');
  const guildId = interaction.guild.id;

  // Cancel existing timer
  if (minutes === 0 || (!minutes && sleepTimers.has(guildId))) {
    clearTimeout(sleepTimers.get(guildId)?.timer);
    sleepTimers.delete(guildId);
    return interaction.editReply('⏰ Sleep timer **cancelled**.');
  }

  if (!minutes || minutes < 1) {
    return interaction.editReply('❌ Provide minutes (1–180) or 0 to cancel.');
  }

  // Clear any existing timer
  if (sleepTimers.has(guildId)) {
    clearTimeout(sleepTimers.get(guildId).timer);
  }

  const endsAt = Date.now() + minutes * 60 * 1000;
  const timer = setTimeout(() => {
    const player = MusicPlayer.get(guildId);
    if (player) {
      player.stop();
      player.destroy();
      const ch = client.channels.cache.get(player.textChannelId);
      if (ch) ch.send('😴 **Sleep timer ended** — Goodnight! 🌙').catch(() => { });
    }
    sleepTimers.delete(guildId);
  }, minutes * 60 * 1000);

  sleepTimers.set(guildId, { timer, endsAt });

  const embed = new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('😴 Sleep Timer Set')
    .setDescription(`Music will stop in **${minutes} minutes** (<t:${Math.floor(endsAt / 1000)}:R>)\nUse \`/sleeptimer 0\` to cancel.`);
  return interaction.editReply({ embeds: [embed] });
}

// ──── /quiz ─ Music trivia game ───────────────────────────────────────────────

async function cmdQuiz(interaction) {
  const guildId = interaction.guild.id;
  const action = interaction.options.getString('action') || 'start';

  if (action === 'stop') {
    const session = quizSessions.get(guildId);
    if (!session) return interaction.editReply('❌ No quiz is running.');
    quizSessions.delete(guildId);

    const scores = Object.entries(session.scores)
      .sort(([, a], [, b]) => b - a)
      .map(([uid, s], i) => `${i === 0 ? '👑' : `${i + 1}.`} <@${uid}> — **${s} pts**`)
      .join('\n') || 'No scores yet.';

    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('🏆 Quiz Over — Final Scores')
      .setDescription(scores);
    return interaction.editReply({ embeds: [embed] });
  }

  // Start a new quiz
  if (quizSessions.has(guildId)) {
    return interaction.editReply('⚠️ A quiz is already running! Use `/quiz stop` to end it.');
  }

  const artist = interaction.options.getString('artist');
  if (!artist) {
    return interaction.editReply('❌ Provide an artist name: `/quiz start artist:Drake`');
  }

  try {
    const tracks = await spotify.getArtistTopTracks(artist, 10);
    if (tracks.length < 4) {
      return interaction.editReply('❌ Not enough tracks found for that artist.');
    }

    const session = {
      tracks,
      current: 0,
      scores: {},
      answered: false,
    };
    quizSessions.set(guildId, session);

    await interaction.editReply(`🎵 **Music Quiz** starting! Artist: **${artist}**\nI\'ll play song snippets — guess the title!`);
    sendQuizRound(interaction.channel, guildId);
  } catch (err) {
    console.error('[Quiz]', err);
    return interaction.editReply('❌ Failed to start quiz.');
  }
}

async function sendQuizRound(channel, guildId) {
  const session = quizSessions.get(guildId);
  if (!session || session.current >= session.tracks.length) {
    // Quiz finished
    const scores = Object.entries(session?.scores || {})
      .sort(([, a], [, b]) => b - a)
      .map(([uid, s], i) => `${i === 0 ? '👑' : `${i + 1}.`} <@${uid}> — **${s} pts**`)
      .join('\n') || 'No scores.';

    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('🏆 Quiz Complete!')
      .setDescription(scores);
    channel.send({ embeds: [embed] }).catch(() => { });
    quizSessions.delete(guildId);
    return;
  }

  const track = session.tracks[session.current];
  session.answered = false;

  // Generate 4 choices (correct + 3 random)
  const others = session.tracks
    .filter((_, i) => i !== session.current)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const choices = [track, ...others].sort(() => Math.random() - 0.5);
  session.correctTitle = track.title;
  session.choices = choices;

  const buttons = choices.map((c, i) =>
    new ButtonBuilder()
      .setCustomId(`quiz_${i}`)
      .setLabel(c.title.slice(0, 80))
      .setStyle(ButtonStyle.Primary)
  );

  const row = new ActionRowBuilder().addComponents(buttons);

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle(`🎵 Round ${session.current + 1}/${session.tracks.length}`)
    .setDescription(`**Artist:** ${track.artist}\n\nWhich song is this?`)
    .setThumbnail(track.thumbnail)
    .setFooter({ text: '15 seconds to answer!' });

  const msg = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);
  if (!msg) return;

  // Collect answers for 15 seconds
  const collector = msg.createMessageComponentCollector({ time: 15000 });

  collector.on('collect', async (btn) => {
    if (session.answered) {
      return btn.reply({ content: 'Already answered!', ephemeral: true });
    }

    const chosen = session.choices[parseInt(btn.customId.split('_')[1])];
    if (chosen.title === session.correctTitle) {
      session.answered = true;
      session.scores[btn.user.id] = (session.scores[btn.user.id] || 0) + 1;
      await btn.reply(`✅ **${btn.user.username}** got it right! It's **${track.title}**! (+1 pt)`);
      collector.stop();
    } else {
      await btn.reply({ content: `❌ Wrong! Try again.`, ephemeral: true });
    }
  });

  collector.on('end', () => {
    if (!session.answered) {
      channel.send(`⏰ Time's up! The answer was **${track.title}**`).catch(() => { });
    }
    // Disable buttons
    const disabledRow = new ActionRowBuilder().addComponents(
      buttons.map(b => ButtonBuilder.from(b).setDisabled(true))
    );
    msg.edit({ components: [disabledRow] }).catch(() => { });

    session.current++;
    // Next round after 3 seconds
    setTimeout(() => sendQuizRound(channel, guildId), 3000);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wire player events (only once per player).
 */
function wirePlayerEvents(player) {
  if (player._eventsWired) return;
  player._eventsWired = true;

  player.on('trackStart', (t) => {
    const ch = client.channels.cache.get(player.textChannelId);
    if (ch) {
      const embed = new EmbedBuilder()
        .setColor(0x1DB954)
        .setAuthor({ name: '🎵 Now Playing' })
        .setTitle(t.title)
        .setURL(t.uri)
        .setDescription(
          `**${t.artist}**\n\`${formatDuration(t.duration)}\` | Requested by <@${t.requester}>`
        )
        .setThumbnail(t.thumbnail);
      ch.send({ embeds: [embed] }).catch(() => { });
    }
  });

  player.on('queueEnd', () => {
    // In 24/7 mode, don't disconnect
    if (player.mode247) return;
    const ch = client.channels.cache.get(player.textChannelId);
    if (ch) ch.send('✅ Queue has finished.').catch(() => { });
  });

  player.on('trackError', (t, err) => {
    console.error(`[TrackError] ${t?.title}: ${err.message}`);
  });
}

function formatDuration(ms) {
  const seconds = Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((ms / (1000 * 60)) % 60)
    .toString()
    .padStart(2, '0');
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24).toString();
  if (hours === '0') return `${minutes}:${seconds}`;
  return `${hours.padStart(2, '0')}:${minutes}:${seconds}`;
}

function createProgressBar(current, total, length = 15) {
  const progress = Math.round((current / total) * length);
  const empty = length - progress;
  return '▬'.repeat(progress) + '🔘' + '▬'.repeat(empty);
}

// ─── Start ────────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN);

// Make client available globally for dashboard
global.botClient = client;

// Launch web dashboard
const { startDashboard } = require('./dashboard/server');
startDashboard();
