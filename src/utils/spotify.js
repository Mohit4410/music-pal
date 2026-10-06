import { config } from '../config.js';

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Obtains or refreshes an official Spotify OAuth2 access token.
 * @returns {Promise<string|null>}
 */
async function getSpotifyToken() {
  const { clientId, clientSecret } = config.spotify;
  if (!clientId || !clientSecret) return null;

  // Use cached token if valid (with 60-second buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  try {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      console.warn(`[Spotify API] Token refresh failed with status ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data.access_token) {
      cachedToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in * 1000);
      return cachedToken;
    }
  } catch (error) {
    console.error('[Spotify API] Error refreshing Spotify token:', error.message);
  }
  return null;
}

/**
 * Checks if a string is a Spotify URL or URI.
 * @param {string} url
 * @returns {boolean}
 */
export function isSpotifyUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /^(https?:\/\/)?(open\.)?spotify\.com\/(intl-[a-z0-9_-]+\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]+)/i.test(url)
    || /^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)/i.test(url);
}

/**
 * Parses link type and ID from a Spotify URL.
 * @param {string} url
 * @returns {{ type: 'track'|'album'|'playlist'|'artist', id: string }|null}
 */
export function parseSpotifyUrl(url) {
  const webMatch = url.match(/spotify\.com\/(?:intl-[a-z0-9_-]+\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]+)/i);
  if (webMatch) {
    return { type: webMatch[1].toLowerCase(), id: webMatch[2] };
  }

  const uriMatch = url.match(/^spotify:(track|album|playlist|artist):([a-zA-Z0-9]+)/i);
  if (uriMatch) {
    return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  }

  return null;
}

/**
 * Resolves a Spotify track, album, or playlist to structured metadata.
 * @param {string} rawUrl
 * @returns {Promise<{
 *   type: 'track'|'album'|'playlist',
 *   name?: string,
 *   artworkUrl?: string,
 *   tracks: Array<{ title: string, author: string, searchQuery: string, durationMs: number, artworkUrl?: string, url?: string }>
 * }|null>}
 */
export async function resolveSpotifyUrl(rawUrl) {
  const parsed = parseSpotifyUrl(rawUrl);
  if (!parsed) return null;

  const token = await getSpotifyToken();

  // If token is unavailable, fall back to public oEmbed for single tracks
  if (!token) {
    if (parsed.type === 'track') {
      try {
        const oembed = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(rawUrl)}`);
        if (oembed.ok) {
          const data = await oembed.json();
          if (data.title) {
            return {
              type: 'track',
              tracks: [
                {
                  title: data.title,
                  author: 'Spotify Artist',
                  searchQuery: data.title,
                  durationMs: 0,
                  artworkUrl: data.thumbnail_url || null,
                  url: rawUrl,
                },
              ],
            };
          }
        }
      } catch (err) {
        console.warn('[Spotify Resolver] Fallback oEmbed failed:', err.message);
      }
    }
    return null;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  try {
    if (parsed.type === 'track') {
      const res = await fetch(`https://api.spotify.com/v1/tracks/${parsed.id}`, { headers });
      if (!res.ok) return null;
      const data = await res.json();

      const artists = data.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
      const mainArtist = data.artists?.[0]?.name || '';

      return {
        type: 'track',
        tracks: [
          {
            title: data.name,
            author: artists,
            searchQuery: `${data.name} ${mainArtist}`.trim(),
            durationMs: data.duration_ms || 0,
            artworkUrl: data.album?.images?.[0]?.url || null,
            url: `https://open.spotify.com/track/${data.id}`,
          },
        ],
      };
    }

    if (parsed.type === 'album') {
      const res = await fetch(`https://api.spotify.com/v1/albums/${parsed.id}`, { headers });
      if (!res.ok) return null;
      const album = await res.json();

      const albumArtwork = album.images?.[0]?.url || null;
      const albumArtist = album.artists?.[0]?.name || '';

      const tracks = (album.tracks?.items || []).map((t) => {
        const artists = t.artists?.map((a) => a.name).join(', ') || albumArtist;
        const mainArtist = t.artists?.[0]?.name || albumArtist;
        return {
          title: t.name,
          author: artists,
          searchQuery: `${t.name} ${mainArtist}`.trim(),
          durationMs: t.duration_ms || 0,
          artworkUrl: albumArtwork,
          url: `https://open.spotify.com/track/${t.id}`,
        };
      });

      return {
        type: 'album',
        name: album.name,
        artworkUrl: albumArtwork,
        tracks,
      };
    }

    if (parsed.type === 'playlist') {
      const res = await fetch(`https://api.spotify.com/v1/playlists/${parsed.id}?fields=name,images,tracks.items(track(id,name,duration_ms,artists,album(images)))`, { headers });
      if (!res.ok) return null;
      const playlist = await res.json();

      const playlistArtwork = playlist.images?.[0]?.url || null;

      const tracks = (playlist.tracks?.items || [])
        .filter((item) => item?.track && item.track.id)
        .map((item) => {
          const t = item.track;
          const artists = t.artists?.map((a) => a.name).join(', ') || 'Unknown Artist';
          const mainArtist = t.artists?.[0]?.name || '';
          return {
            title: t.name,
            author: artists,
            searchQuery: `${t.name} ${mainArtist}`.trim(),
            durationMs: t.duration_ms || 0,
            artworkUrl: t.album?.images?.[0]?.url || playlistArtwork,
            url: `https://open.spotify.com/track/${t.id}`,
          };
        });

      return {
        type: 'playlist',
        name: playlist.name,
        artworkUrl: playlistArtwork,
        tracks,
      };
    }
  } catch (apiError) {
    console.error('[Spotify Resolver] API request error:', apiError.message);
  }

  return null;
}
