import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Discord Bot
  discordToken: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '', // Optional: For instant guild-level command testing

  // Lavalink v4
  // SERVER_PORT is set by Pterodactyl/Bot-Hosting.net to the dynamically allocated host port.
  // Lavalink's application.yml reads the same env var so both agree on the bound port.
  lavalink: {
    host: process.env.LAVALINK_HOST || '127.0.0.1',
    port: parseInt(process.env.SERVER_PORT || process.env.LAVALINK_PORT || '2333', 10),
    password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure: process.env.LAVALINK_SECURE === 'true',
  },

  // Spotify API (for seamless Spotify URL -> high-fidelity stream resolution)
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  },

  // Audio Playback & Bot Behavior
  defaultPrefix: process.env.DEFAULT_PREFIX || '!',
  defaultVolume: 100, // Locked to 100% (gain = 1.0) for bit-transparent reproduction
  leaveOnEmptyTimeoutMs: (parseInt(process.env.LEAVE_ON_EMPTY_TIMEOUT_SECONDS || '30', 10)) * 1000,
};

export function validateConfig() {
  const missing = [];
  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');

  if (missing.length > 0) {
    console.warn(`[Config Warning] The following environment variables are unset: ${missing.join(', ')}`);
  }
}
