import { EmbedBuilder } from 'discord.js';

/**
 * Format milliseconds into a human-readable duration string (mm:ss or hh:mm:ss).
 * @param {number} ms 
 * @param {boolean} isStream 
 * @returns {string}
 */
export function formatDuration(ms, isStream = false) {
  if (isStream || !ms || ms <= 0) return '🔴 LIVE';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Generates an ASCII progress bar for audio playback.
 * @param {number} currentMs Current position in milliseconds
 * @param {number} totalMs Total duration in milliseconds
 * @param {number} size Number of bar steps
 * @returns {string}
 */
export function createProgressBar(currentMs, totalMs, size = 15) {
  if (!totalMs || totalMs <= 0) return '🔘' + '▬'.repeat(size);

  const progress = Math.min(Math.max(currentMs / totalMs, 0), 1);
  const progressIndex = Math.round(progress * size);

  const bar = '▬'.repeat(progressIndex) + '🔘' + '▬'.repeat(Math.max(size - progressIndex, 0));
  return bar;
}

/**
 * Creates a standardized Embed for tracks.
 * @param {import('moonlink.js').Track} track
 * @param {string} titlePrefix
 * @param {number} [positionMs]
 * @returns {EmbedBuilder}
 */
export function createTrackEmbed(track, titlePrefix = 'Now Playing', positionMs = 0) {
  const isStream = track.isStream || false;
  const duration = formatDuration(track.duration, isStream);
  const position = formatDuration(positionMs, isStream);

  const embed = new EmbedBuilder()
    .setColor(0xff5500) // SoundCloud signature orange
    .setTitle(`${titlePrefix}: ${track.title}`)
    .setURL(track.url || 'https://soundcloud.com')
    .setAuthor({
      name: track.author || 'Unknown Artist',
      iconURL: 'https://a-v2.sndcdn.com/assets/images/sc-icons/favicon-2cadd14bdb.ico',
    })
    .addFields(
      {
        name: '⏱️ Duration',
        value: isStream ? '🔴 Live Stream' : `${position} / ${duration}`,
        inline: true,
      },
      {
        name: '🎧 Source',
        value: `${track.sourceName || 'SoundCloud'} (Opus 48kHz)`,
        inline: true,
      },
      {
        name: '🎚️ Gain Mode',
        value: 'Bit-Perfect 100% (No Clipping)',
        inline: true,
      }
    )
    .setFooter({
      text: track.requester?.tag ? `Requested by ${track.requester.tag}` : 'Lavalink v4 • High-Fidelity Audio',
      iconURL: track.requester?.displayAvatarURL?.() || undefined,
    })
    .setTimestamp();

  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  }

  if (!isStream && track.duration > 0) {
    const bar = createProgressBar(positionMs, track.duration);
    embed.addFields({
      name: 'Playback Progress',
      value: `\`${position}\` ${bar} \`${duration}\``,
      inline: false,
    });
  }

  return embed;
}
