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
      let stream;
      let streamError = null;

      // 1️⃣ ATTEMPT YOUTUBE FOR HIGH QUALITY
      try {
        const ytResults = await play.search(`${track.title} ${track.artist}`, { limit: 5 });
        if (ytResults && ytResults.length > 0) {
          const avoidWords = ['remix', 'cover', 'slowed', 'reverb', 'sped up', 'nightcore', 'mashup', '8d', 'instrumental', 'karaoke', 'pitch'];
          const titleLower = track.title.toLowerCase();
          const wordsToFilter = avoidWords.filter(w => !titleLower.includes(w));

          let bestMatch = ytResults[0];
          for (const res of ytResults) {
            const resName = (res.title || '').toLowerCase();
            const hasBadWord = wordsToFilter.some(w => resName.includes(w));
            if (!hasBadWord) {
              bestMatch = res;
              break;
            }
          }

          stream = await play.stream(bestMatch.url, { discordPlayerCompatibility: true });
        }
      } catch (err) {
        console.warn(`[MusicPlayer] YouTube stream failed for ${track.title}. Falling back to SoundCloud...`);
        streamError = err.message;
      }

      // 2️⃣ FALLBACK TO SOUNDCLOUD IF YOUTUBE IS BLOCKED (e.g. rate limits)
      if (!stream) {
        const scResults = await play.search(`${track.title} ${track.artist}`, {
          source: { soundcloud: 'tracks' }, limit: 5
        });

        if (scResults && scResults.length > 0) {
          // Filter to avoid bad versions unless specifically requested
          const avoidWords = ['remix', 'cover', 'slowed', 'reverb', 'sped up', 'nightcore', 'mashup', '8d', 'instrumental', 'karaoke'];
          const titleLower = track.title.toLowerCase();

          // Only filter out words that aren't in the original requested title
          const wordsToFilter = avoidWords.filter(w => !titleLower.includes(w));

          let bestMatch = scResults[0]; // fallback to first result

          for (const res of scResults) {
            const resName = (res.name || res.title || '').toLowerCase();
            const hasBadWord = wordsToFilter.some(w => resName.includes(w));

            if (!hasBadWord) {
              bestMatch = res;
              break;
            }
          }

          stream = await play.stream(bestMatch.url);
        } else {
          throw new Error(streamError || 'No audio source found on any platform.');
        }
      }

      // Optimize resource for highest bitrate avoiding buffering drops
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type,
        inlineVolume: true,
        silencePaddingFrames: 5, // fill dropouts
      });

      resource.volume?.setVolume(this.volume / 100);
      this.audioPlayer.play(resource);
      this.resource = resource;

      this.emit('trackStart', track);
    } catch (err) {
      console.error(`[MusicPlayer] Stream error for "${track.title}":`, err.message);
      this.emit('trackError', track, err);
      // Wait a moment before skipping to avoid spamming the API
      setTimeout(() => this.playNext(), 2000);
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
