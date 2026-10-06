import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { formatDuration } from '../utils/formatters.js';

export const data = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('Displays the currently playing track and the upcoming playlist queue');

export async function execute(interaction, client, manager) {
  const player = manager.players.get(interaction.guild.id);

  if (!player || (!player.current && player.queue.size === 0)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('📭 The queue is currently empty.'),
      ],
      ephemeral: true,
    });
  }

  const current = player.current;
  const queueTracks = player.queue.all || [];
  const totalQueueDuration = queueTracks.reduce((acc, t) => acc + (t.duration || 0), 0);

  const embed = new EmbedBuilder()
    .setColor(0xff5500)
    .setTitle(`🎶 Server Music Queue — ${interaction.guild.name}`);

  if (current) {
    embed.addFields({
      name: 'Now Playing',
      value: `**[${current.title}](${current.url || 'https://soundcloud.com'})**\n` +
        `Artist: \`${current.author || 'Unknown'}\` | Duration: \`${formatDuration(current.duration, current.isStream)}\` | Requested by: ${current.requester?.tag || 'Unknown'}`,
      inline: false,
    });
  }

  if (queueTracks.length === 0) {
    embed.addFields({
      name: 'Upcoming Tracks',
      value: '*No upcoming tracks in the queue. Add more using `/play`!*',
      inline: false,
    });
  } else {
    // Show top 10 items to prevent Discord message size limits
    const maxDisplay = 10;
    const displayedTracks = queueTracks.slice(0, maxDisplay);

    const listString = displayedTracks
      .map((t, idx) => {
        const dur = formatDuration(t.duration, t.isStream);
        return `\`${idx + 1}.\` **[${t.title}](${t.url || 'https://soundcloud.com'})** — \`${dur}\` (by ${t.requester?.tag || 'User'})`;
      })
      .join('\n');

    const remaining = queueTracks.length - maxDisplay;
    const footerNote = remaining > 0 ? `\n\n*...and ${remaining} more track${remaining === 1 ? '' : 's'}*` : '';

    embed.addFields({
      name: `Up Next (${queueTracks.length} track${queueTracks.length === 1 ? '' : 's'} • Total: ${formatDuration(totalQueueDuration)})`,
      value: `${listString}${footerNote}`,
      inline: false,
    });
  }

  embed.setFooter({
    text: `Lavalink v4 • Volume: 100% Bit-Perfect • ${player.queue.size} item(s) pending`,
  });

  return interaction.reply({ embeds: [embed] });
}
