/**
 * Spotify Web API client using Client Credentials flow.
 * Handles token auto-refresh and track/search operations.
 */

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

let accessToken = null;
let tokenExpiry = 0;

/**
 * Get (or refresh) a Spotify access token using client credentials.
 */
async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in .env');
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  // Expire 60 seconds early to be safe
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken;
}

/**
 * Spotify API request helper.
 */
async function spotifyFetch(endpoint) {
  const token = await getAccessToken();
  const res = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Parse a Spotify item (track) into a simplified object.
 */
function parseTrack(item) {
  const artistName = item.artists && item.artists.length > 0 ? item.artists[0].name : "Unknown Artist";
  return {
    title: item.name || 'Unknown Track',
    artist: item.artists && item.artists.length > 0 ? item.artists.map((a) => a.name).join(', ') : 'Unknown Artist',
    album: item.album?.name ?? '',
    duration: item.duration_ms || 0,
    thumbnail: item.album?.images?.[0]?.url ?? '',
    uri: item.external_urls?.spotify ?? '',
    spotifyId: item.id || '',
    searchQuery: `${artistName} ${item.name || ''}`,
  };
}

/**
 * Search Spotify for tracks by query string.
 * @returns {Array} Array of parsed track objects
 */
async function searchTracks(query, limit = 5) {
  const data = await spotifyFetch(
    `/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
  );
  if (!data.tracks?.items?.length) return [];
  return data.tracks.items.map(parseTrack);
}

/**
 * Get a single track by Spotify track ID or URL.
 */
async function getTrackByUrl(url) {
  // Extract track ID from various Spotify URL formats
  const match = url.match(/track[/:]([a-zA-Z0-9]+)/);
  if (!match) return null;

  const trackId = match[1];
  const data = await spotifyFetch(`/tracks/${trackId}`);
  return parseTrack(data);
}

/**
 * Check whether a string looks like a Spotify URL/URI.
 */
function isSpotifyUrl(str) {
  return (
    str.includes('open.spotify.com/track') ||
    str.startsWith('spotify:track:')
  );
}

/**
 * Get Spotify recommendations based on seed track IDs.
 * @param {string[]} seedTrackIds - Up to 5 Spotify track IDs
 * @param {number} limit - Number of recommendations (default 5)
 * @returns {Array} Parsed track objects
 */
async function getRecommendations(seedTrackIds, limit = 5) {
  const seeds = seedTrackIds.slice(0, 5).join(',');
  const data = await spotifyFetch(
    `/recommendations?seed_tracks=${seeds}&limit=${limit}`
  );
  if (!data.tracks?.length) return [];
  return data.tracks.map(parseTrack);
}

/**
 * Get a Spotify artist's top tracks.
 * @param {string} artistQuery - Artist name to search
 * @param {number} limit - Max tracks to return
 * @returns {Array} Parsed track objects
 */
async function getArtistTopTracks(artistQuery, limit = 5) {
  // Step 1: find the artist
  const searchData = await spotifyFetch(
    `/search?q=${encodeURIComponent(artistQuery)}&type=artist&limit=1`
  );
  const artist = searchData.artists?.items?.[0];
  if (!artist) return [];

  // Step 2: get their top tracks
  const topData = await spotifyFetch(
    `/artists/${artist.id}/top-tracks?market=US`
  );
  if (!topData.tracks?.length) return [];
  return topData.tracks.slice(0, limit).map(parseTrack);
}

module.exports = {
  searchTracks,
  getTrackByUrl,
  isSpotifyUrl,
  getRecommendations,
  getArtistTopTracks,
};
