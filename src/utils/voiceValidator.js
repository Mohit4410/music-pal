import { PermissionsBitField, EmbedBuilder } from 'discord.js';

/**
 * Validates voice requirements for interaction or message author.
 * @param {import('discord.js').GuildMember} member Member issuing the command
 * @param {import('discord.js').Guild} guild Guild where command was issued
 * @param {import('moonlink.js').Manager} manager Lavalink manager
 * @returns {{ valid: boolean, errorEmbed?: EmbedBuilder, voiceChannel?: import('discord.js').VoiceBasedChannel, player?: import('moonlink.js').Player }}
 */
export function validateVoiceState(member, guild, manager) {
  const voiceChannel = member.voice?.channel;

  // 1. User must be in a voice channel
  if (!voiceChannel) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setDescription('❌ You must join a voice channel before using this command!');
    return { valid: false, errorEmbed };
  }

  // 2. Bot must have necessary voice permissions in the user's channel
  const botMember = guild.members.me;
  const permissions = voiceChannel.permissionsFor(botMember);

  const missingPermissions = [];
  if (!permissions.has(PermissionsBitField.Flags.ViewChannel)) missingPermissions.push('View Channel');
  if (!permissions.has(PermissionsBitField.Flags.Connect)) missingPermissions.push('Connect');
  if (!permissions.has(PermissionsBitField.Flags.Speak)) missingPermissions.push('Speak');

  if (missingPermissions.length > 0) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🔒 Missing Voice Channel Permissions')
      .setDescription(
        `I am missing the following required permissions in <#${voiceChannel.id}>:\n` +
        missingPermissions.map((p) => `• \`${p}\``).join('\n')
      );
    return { valid: false, errorEmbed };
  }

  // 3. If bot is already connected, ensure user is in the same channel
  const existingPlayer = manager.players.get(guild.id);
  if (existingPlayer && existingPlayer.connected && existingPlayer.voiceChannelId) {
    if (existingPlayer.voiceChannelId !== voiceChannel.id) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setDescription(`⚠️ You must be in the same voice channel as the bot (<#${existingPlayer.voiceChannelId}>) to control playback!`);
      return { valid: false, errorEmbed, player: existingPlayer };
    }
  }

  return { valid: true, voiceChannel, player: existingPlayer };
}
