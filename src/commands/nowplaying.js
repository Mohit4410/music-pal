import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { createTrackEmbed } from '../utils/formatters.js';

export const data = new SlashCommandBuilder()
  .setName('nowplaying')
  .setDescription('Displays information and playback progress for the active track');

export async function execute(interaction, client, manager) {
  const player = manager.players.get(interaction.guild.id);

  if (!player || !player.current) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('⚠️ No track is currently playing in this server.'),
      ],
      ephemeral: true,
    });
  }

  const track = player.current;
  const currentPosition = player.lastPosition || 0;

  const embed = createTrackEmbed(track, '🎶 Now Playing', currentPosition);

  // Add extra status metadata
  embed.addFields({
    name: 'Player State',
    value: player.paused ? '⏸️ Paused' : '▶️ Playing',
    inline: true,
  });

  return interaction.reply({ embeds: [embed] });
}
