import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { validateVoiceState } from '../utils/voiceValidator.js';

export const data = new SlashCommandBuilder()
  .setName('resume')
  .setDescription('Resumes paused audio playback');

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
          .setDescription('⚠️ No active audio track to resume!'),
      ],
      ephemeral: true,
    });
  }

  if (!player.paused) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('▶️ Audio is already playing!'),
      ],
      ephemeral: true,
    });
  }

  await player.resume();

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription('▶️ Resumed playback.');

  return interaction.reply({ embeds: [embed] });
}
