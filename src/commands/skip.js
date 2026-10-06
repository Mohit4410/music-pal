import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { validateVoiceState } from '../utils/voiceValidator.js';

export const data = new SlashCommandBuilder()
  .setName('skip')
  .setDescription('Skips the currently playing track');

export async function execute(interaction, client, manager) {
  const validation = validateVoiceState(interaction.member, interaction.guild, manager);
  if (!validation.valid) {
    return interaction.reply({ embeds: [validation.errorEmbed], ephemeral: true });
  }

  const player = manager.players.get(interaction.guild.id);
  if (!player || (!player.playing && !player.paused)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('⚠️ There is no active track to skip!'),
      ],
      ephemeral: true,
    });
  }

  const currentTrack = player.current;
  const skippedTitle = currentTrack?.title || 'Current Track';

  await player.skip();

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription(`⏭️ Skipped **${skippedTitle}**.`);

  return interaction.reply({ embeds: [embed] });
}
