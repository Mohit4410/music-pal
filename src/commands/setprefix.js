import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getGuildPrefix, setGuildPrefix, resetGuildPrefix } from '../utils/prefixManager.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('setprefix')
  .setDescription('Sets the text command prefix for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('prefix')
      .setDescription('The new prefix (1-5 characters, e.g. "!", "?", "-") or "default" to reset')
      .setRequired(true)
  );

/**
 * Handles prefix change logic
 */
export async function execute(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: '❌ This command can only be used in a server.',
      ephemeral: true,
    });
  }

  // Check permissions
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription('🔒 You need the **Manage Server** permission to change the bot prefix.'),
      ],
      ephemeral: true,
    });
  }

  const rawPrefix = interaction.options.getString('prefix', true).trim();

  // Reset option
  if (rawPrefix.toLowerCase() === 'default' || rawPrefix.toLowerCase() === 'reset') {
    resetGuildPrefix(interaction.guild.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🔄 Prefix Reset')
      .setDescription(`Server prefix has been reset to default: \`${config.defaultPrefix}\``)
      .addFields({
        name: 'Example Usage',
        value: `\`${config.defaultPrefix}play maharani\``,
      });

    return interaction.reply({ embeds: [embed] });
  }

  // Validation: 1 to 5 chars, no whitespace
  if (rawPrefix.length > 5 || /\s/.test(rawPrefix)) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('⚠️ Prefix must be between **1 and 5 characters** and contain no spaces.'),
      ],
      ephemeral: true,
    });
  }

  setGuildPrefix(interaction.guild.id, rawPrefix);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Prefix Updated')
    .setDescription(`Successfully set server text prefix to: **\`${rawPrefix}\`**`)
    .addFields(
      { name: 'Example Usage', value: `\`${rawPrefix}play <song>\`\n\`${rawPrefix}stop\`` },
      { name: 'Reset Prefix', value: `Use \`/setprefix prefix:default\` or \`${rawPrefix}setprefix default\` anytime.` }
    );

  return interaction.reply({ embeds: [embed] });
}

/**
 * Text prefix execution fallback (<prefix>setprefix <new_prefix>)
 */
export async function executePrefix(message, args) {
  if (!message.guild || !message.member) return;

  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription('🔒 You need the **Manage Server** permission to change the bot prefix.'),
      ],
    });
  }

  const newPrefix = args[0]?.trim();
  if (!newPrefix) {
    const currentPrefix = getGuildPrefix(message.guild.id);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription(`Current prefix is: **\`${currentPrefix}\`**\nUsage: \`${currentPrefix}setprefix <new_prefix>\` or \`${currentPrefix}setprefix default\``),
      ],
    });
  }

  if (newPrefix.toLowerCase() === 'default' || newPrefix.toLowerCase() === 'reset') {
    resetGuildPrefix(message.guild.id);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🔄 Prefix Reset')
          .setDescription(`Server prefix has been reset to default: \`${config.defaultPrefix}\``),
      ],
    });
  }

  if (newPrefix.length > 5 || /\s/.test(newPrefix)) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfee75c)
          .setDescription('⚠️ Prefix must be between **1 and 5 characters** without spaces.'),
      ],
    });
  }

  setGuildPrefix(message.guild.id, newPrefix);

  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Prefix Updated')
        .setDescription(`Successfully set server text prefix to: **\`${newPrefix}\`**\nExample: \`${newPrefix}play maharani\``),
    ],
  });
}
