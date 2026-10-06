import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { validateVoiceState } from '../utils/voiceValidator.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stops playback, clears the queue, and disconnects the bot');

/**
 * Common stop handler
 */
export async function handleStopRequest({ member, guild, manager, respond }) {
  const validation = validateVoiceState(member, guild, manager);
  if (!validation.valid) {
    return respond({ embeds: [validation.errorEmbed], ephemeral: true });
  }

  const player = manager.players.get(guild.id);
  if (!player) {
    return respond({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('⚠️ No active audio player is running in this server.'),
      ],
      ephemeral: true,
    });
  }

  // Clear queue and stop Lavalink playback stream
  player.queue.clear();
  try {
    await player.stop();
  } catch (err) {
    console.warn('[Stop Command] Player stop warning:', err.message);
  }

  // Destroy session and leave voice channel
  await player.destroy('Stopped by user');

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⏹️ Playback Stopped')
    .setDescription('Cleared the queue and cleanly disconnected from the voice channel.');

  return respond({ embeds: [embed] });
}

export async function execute(interaction, client, manager) {
  await handleStopRequest({
    member: interaction.member,
    guild: interaction.guild,
    manager,
    respond: (data) => interaction.reply(data),
  });
}

export async function executePrefix(message, args, client, manager) {
  await handleStopRequest({
    member: message.member,
    guild: message.guild,
    manager,
    respond: (data) => message.reply(data),
  });
}
