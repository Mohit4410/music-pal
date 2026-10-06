import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { validateVoiceState } from '../utils/voiceValidator.js';

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pauses current audio playback');

export async function execute(interaction, client, manager) {
  const validation = validateVoiceState(interaction.member, interaction.guild, manager);
  if (!validation.valid) {
    return interaction.reply({ embeds: [validation.errorEmbed], ephemeral: true });
  }

  const player = manager.players.get(interaction.guild.id);
  if (!player || !player.current) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('⚠️ No active audio track to pause!'),
      ],
      ephemeral: true,
    });
  }

  if (player.paused) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('⏸️ Audio playback is already paused! Use `/resume` to continue.'),
      ],
      ephemeral: true,
    });
  }

  await player.pause();

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription('⏸️ Paused playback. Use `/resume` to continue listening.');

  return interaction.reply({ embeds: [embed] });
}
