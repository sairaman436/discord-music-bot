/**
 * MusicPlayer — Voice playback engine using @discordjs/voice + play-dl (SoundCloud).
 * No Lavalink, no YouTube. Searches SoundCloud for audio matching Spotify metadata.
 */

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const EventEmitter = require('events');

// ─── Per-guild player store ──────────────────────────────────────────────────

const players = new Map();

// ─── Queue Item structure (plain object) ─────────────────────────────────────
// { title, artist, duration, thumbnail, uri, searchQuery, requester }

// ─── GuildPlayer class ───────────────────────────────────────────────────────

class GuildPlayer extends EventEmitter {
  constructor(guild, voiceChannel, textChannel, client) {
    super();
    this.guildId = guild.id;
    this.guild = guild;
    this.voiceChannelId = voiceChannel.id;
    this.textChannelId = textChannel;
    this.client = client;

    this.queue = [];
    this.current = null;
    this.loopTrack = false;
    this.loopQueue = false;
    this.volume = 80; // percent
    this.paused = false;

    // Create audio player
    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    // Join the voice channel
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.subscribe(this.audioPlayer);

    // ── Audio player events ──────────────────────────────────────────────
    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this._onTrackEnd();
    });

    this.audioPlayer.on('error', (err) => {
      console.error(`[AudioPlayer] Error: ${err.message}`);
      this.emit('trackError', this.current, err);
      this._onTrackEnd();
    });

    // ── Voice connection events ──────────────────────────────────────────
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Try to reconnect within 5 seconds
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  async playNext() {
    if (this.queue.length === 0) {
      this.current = null;
      this.emit('queueEnd');
      // In 24/7 mode, stay connected
      if (!this.mode247) {
        this.destroy();
      }
      return;
    }

    const track = this.queue.shift();
    this.current = track;

    try {
      // Search SoundCloud for a matching track
      const searchResults = await play.search(track.searchQuery, {
        source: { soundcloud: 'tracks' },
        limit: 1,
      });

      if (!searchResults || searchResults.length === 0) {
        console.warn(`[MusicPlayer] No SoundCloud result for: ${track.searchQuery}`);
        this.emit('trackError', track, new Error('No audio source found on SoundCloud'));
        // Try next track
        return this.playNext();
      }

      const scTrack = searchResults[0];
      const stream = await play.stream(scTrack.url);

      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true,
      });

      resource.volume?.setVolume(this.volume / 100);
      this.audioPlayer.play(resource);
      this.resource = resource;

      this.emit('trackStart', track);
    } catch (err) {
      console.error(`[MusicPlayer] Stream error for "${track.title}":`, err.message);
      this.emit('trackError', track, err);
      return this.playNext();
    }
  }

  _onTrackEnd() {
    if (this.loopTrack && this.current) {
      // Re-queue the same track at the front
      this.queue.unshift({ ...this.current });
    } else if (this.loopQueue && this.current) {
      // Push current track to the end
      this.queue.push({ ...this.current });
    }
    this.playNext();
  }

  // ── Queue Operations ────────────────────────────────────────────────────────

  addTrack(track) {
    this.queue.push(track);
  }

  skip() {
    this.audioPlayer.stop(true); // triggers Idle → _onTrackEnd
  }

  stop() {
    this.queue = [];
    this.loopTrack = false;
    this.loopQueue = false;
    this.audioPlayer.stop(true);
  }

  pause() {
    this.audioPlayer.pause();
    this.paused = true;
  }

  resume() {
    this.audioPlayer.unpause();
    this.paused = false;
  }

  setVolume(level) {
    this.volume = level;
    if (this.resource?.volume) {
      this.resource.volume.setVolume(level / 100);
    }
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  get playing() {
    return this.audioPlayer.state.status === AudioPlayerStatus.Playing;
  }

  destroy() {
    try {
      this.audioPlayer.stop(true);
    } catch { }
    try {
      this.connection.destroy();
    } catch { }
    players.delete(this.guildId);
  }
}

// ─── Module-level helpers ────────────────────────────────────────────────────

/**
 * Get or create a GuildPlayer for a guild.
 */
function getOrCreate(guild, voiceChannel, textChannelId, client) {
  if (players.has(guild.id)) return players.get(guild.id);

  const gp = new GuildPlayer(guild, voiceChannel, textChannelId, client);
  players.set(guild.id, gp);
  return gp;
}

/**
 * Get an existing GuildPlayer (or null).
 */
function get(guildId) {
  return players.get(guildId) || null;
}

/**
 * Number of active players.
 */
function activeCount() {
  return players.size;
}

module.exports = { getOrCreate, get, activeCount };
