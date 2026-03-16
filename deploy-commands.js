require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('play').setDescription('Play a song or add to queue')
    .addStringOption(o => o.setName('query').setDescription('Song name, YouTube URL, or Spotify URL').setRequired(true)),

  new SlashCommandBuilder()
    .setName('skip').setDescription('Skip the current song'),

  new SlashCommandBuilder()
    .setName('stop').setDescription('Stop music and disconnect'),

  new SlashCommandBuilder()
    .setName('pause').setDescription('Pause the current song'),

  new SlashCommandBuilder()
    .setName('resume').setDescription('Resume playback'),

  new SlashCommandBuilder()
    .setName('queue').setDescription('Show the song queue'),

  new SlashCommandBuilder()
    .setName('np').setDescription('Show what is currently playing'),

  new SlashCommandBuilder()
    .setName('volume').setDescription('Set the volume (1–100)')
    .addIntegerOption(o => o.setName('level').setDescription('Volume level').setMinValue(1).setMaxValue(100).setRequired(true)),

  new SlashCommandBuilder()
    .setName('shuffle').setDescription('Shuffle the queue'),

  new SlashCommandBuilder()
    .setName('loop').setDescription('Toggle loop mode for current song')
    .addStringOption(o =>
      o.setName('mode')
        .setDescription('Loop mode')
        .setRequired(true)
        .addChoices(
          { name: 'track', value: 'track' },
          { name: 'queue', value: 'queue' }
        )
    ),

  new SlashCommandBuilder()
    .setName('lyrics').setDescription('Get lyrics for current or named song')
    .addStringOption(o => o.setName('song').setDescription('Song name (optional — defaults to current)').setRequired(false)),

  // ── SPECIAL FEATURES ──────────────────────────────────────────────

  new SlashCommandBuilder()
    .setName('recommend').setDescription('🤖 Get AI-powered song recommendations based on current track')
    .addIntegerOption(o => o.setName('count').setDescription('Number of recommendations (1–10)').setMinValue(1).setMaxValue(10).setRequired(false)),

  new SlashCommandBuilder()
    .setName('247').setDescription('🌙 Toggle 24/7 mode — bot stays in VC even when queue is empty'),

  new SlashCommandBuilder()
    .setName('favorite').setDescription('❤️ Manage your personal song favorites')
    .addStringOption(o =>
      o.setName('action').setDescription('What to do').setRequired(true)
        .addChoices(
          { name: '❤️ Add current song', value: 'add' },
          { name: '📋 List favorites', value: 'list' },
          { name: '▶️ Play all favorites', value: 'play' },
          { name: '🗑️ Remove by number', value: 'remove' },
        )
    )
    .addIntegerOption(o => o.setName('number').setDescription('Song number to remove (for remove action)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('sleeptimer').setDescription('😴 Auto-stop music after X minutes')
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes until stop (0 to cancel)').setMinValue(0).setMaxValue(180).setRequired(true)),

  new SlashCommandBuilder()
    .setName('quiz').setDescription('🎵 Music trivia game — guess the song!')
    .addStringOption(o =>
      o.setName('action').setDescription('Start or stop').setRequired(true)
        .addChoices(
          { name: '▶️ Start quiz', value: 'start' },
          { name: '⏹️ Stop quiz', value: 'stop' },
        )
    )
    .addStringOption(o => o.setName('artist').setDescription('Artist name for the quiz').setRequired(false)),

].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('✅ Slash commands registered! You can now run index.js');
})();
