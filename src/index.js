import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  EmbedBuilder,
} from 'discord.js';
import { config, validateConfig } from './config.js';
import { createLavalinkManager } from './lavalink.js';

// Import commands
import * as playCommand from './commands/play.js';
import * as skipCommand from './commands/skip.js';
import * as stopCommand from './commands/stop.js';
import * as queueCommand from './commands/queue.js';
import * as nowplayingCommand from './commands/nowplaying.js';
import * as pauseCommand from './commands/pause.js';
import * as resumeCommand from './commands/resume.js';
import * as setprefixCommand from './commands/setprefix.js';
import { getGuildPrefix } from './utils/prefixManager.js';

validateConfig();

// Initialize Discord Client with necessary gateway intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Register Slash Commands in collection
client.commands = new Collection();
const commandList = [
  playCommand,
  skipCommand,
  stopCommand,
  queueCommand,
  nowplayingCommand,
  pauseCommand,
  resumeCommand,
  setprefixCommand,
];

for (const command of commandList) {
  client.commands.set(command.data.name, command);
}

// Initialize Lavalink Manager (Moonlink.js v4 integration)
const manager = createLavalinkManager(client);

// Explicit packet routing for Discord Voice Gateway updates to Lavalink
client.on('raw', (packet) => {
  if (['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(packet.t)) {
    manager.packetUpdate(packet);
  }
});

// Map to manage 30-second grace timer when voice channel becomes empty of humans
const autoLeaveTimers = new Map();

/**
 * Handle Auto-Leave when all human members disconnect
 */
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guild = oldState.guild || newState.guild;
  const player = manager.players.get(guild.id);

  if (!player || !player.connected || !player.voiceChannelId) {
    if (autoLeaveTimers.has(guild.id)) {
      clearTimeout(autoLeaveTimers.get(guild.id));
      autoLeaveTimers.delete(guild.id);
    }
    return;
  }

  const voiceChannel = guild.channels.cache.get(player.voiceChannelId);
  if (!voiceChannel) return;

  // Filter non-bot members currently inside the voice channel
  const humanMembers = voiceChannel.members.filter((member) => !member.user.bot);

  if (humanMembers.size === 0) {
    // Only start timer if one isn't already counting down
    if (!autoLeaveTimers.has(guild.id)) {
      console.log(`[Auto-Leave] Voice channel "${voiceChannel.name}" in guild "${guild.name}" has no human listeners. Starting ${config.leaveOnEmptyTimeoutMs / 1000}s grace timer...`);

      const timer = setTimeout(async () => {
        autoLeaveTimers.delete(guild.id);
        const currentPlayer = manager.players.get(guild.id);
        if (!currentPlayer) return;

        const currentChannel = guild.channels.cache.get(currentPlayer.voiceChannelId);
        if (currentChannel && currentChannel.members.filter((m) => !m.user.bot).size === 0) {
          console.log(`[Auto-Leave] Grace timer expired for "${guild.name}". Disconnecting bot to conserve resources.`);

          if (currentPlayer.textChannelId) {
            const textChannel = guild.channels.cache.get(currentPlayer.textChannelId);
            if (textChannel && textChannel.isTextBased()) {
              textChannel.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0xfee75c)
                    .setDescription(`⏱️ Disconnected from the voice channel because all human listeners left (${config.leaveOnEmptyTimeoutMs / 1000}s grace timer expired).`),
                ],
              }).catch(() => {});
            }
          }

          currentPlayer.queue.clear();
          await currentPlayer.destroy('Voice channel left empty of human listeners');
        }
      }, config.leaveOnEmptyTimeoutMs);

      autoLeaveTimers.set(guild.id, timer);
    }
  } else {
    // Human listener is present: cancel active grace countdown
    if (autoLeaveTimers.has(guild.id)) {
      clearTimeout(autoLeaveTimers.get(guild.id));
      autoLeaveTimers.delete(guild.id);
      console.log(`[Auto-Leave] Human listener detected in "${voiceChannel.name}". Grace timer cancelled.`);
    }
  }
});

/**
 * Handle Slash Command Interactions
 */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, client, manager);
  } catch (error) {
    console.error(`[Command Error] Error executing /${interaction.commandName}:`, error);

    const errorEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Command Execution Error')
      .setDescription('An unexpected error occurred while processing your command.');

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(() => {});
    }
  }
});

/**
 * Handle Text Prefix Fallbacks (!play, !stop, !setprefix)
 */
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;

  const prefix = getGuildPrefix(message.guild.id);
  if (!message.content.startsWith(prefix)) return;

  const [commandName, ...args] = message.content
    .slice(prefix.length)
    .trim()
    .split(/\s+/);

  if (!commandName) return;

  const lowerCmd = commandName.toLowerCase();

  try {
    if (lowerCmd === 'play') {
      await playCommand.executePrefix(message, args, client, manager);
    } else if (lowerCmd === 'stop') {
      await stopCommand.executePrefix(message, args, client, manager);
    } else if (lowerCmd === 'setprefix') {
      await setprefixCommand.executePrefix(message, args);
    }
  } catch (error) {
    console.error(`[Prefix Command Error] Error running ${prefix}${lowerCmd}:`, error);
    message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setDescription(`❌ Failed to execute \`${prefix}${lowerCmd}\`: ${error.message}`),
      ],
    }).catch(() => {});
  }
});

/**
 * Client Ready Event
 */
client.once(Events.ClientReady, (c) => {
  console.log(`=============================================`);
  console.log(`🚀 Music Bot Online: ${c.user.tag} (ID: ${c.user.id})`);
  console.log(`🎚️ Audio Architecture: Lavalink v4 [SoundCloud Engine]`);
  console.log(`🎛️ Audio Pipeline: 400ms Buffer | Opus Q10 | High Resampling`);
  console.log(`⚡ Internal Gain: 100% Locked (Bit-Perfect Mode)`);
  console.log(`=============================================`);
});

/**
 * Graceful Process Shutdown
 */
async function handleShutdown(signal) {
  console.log(`\n[Process] Received ${signal}. Shutting down cleanly...`);

  // Clear all pending grace timers
  for (const timer of autoLeaveTimers.values()) {
    clearTimeout(timer);
  }
  autoLeaveTimers.clear();

  // Destroy all active Lavalink players
  try {
    const activePlayers = manager.players.all;
    for (const player of activePlayers) {
      await player.destroy('Bot shutdown');
    }
  } catch (err) {
    console.warn('[Process] Error destroying players on shutdown:', err.message);
  }

  // Destroy client session
  client.destroy();
  console.log('[Process] Bot shut down gracefully.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection] at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception] caught:', error);
});

// Start Discord Bot
if (!config.discordToken) {
  console.error('[Startup Error] DISCORD_TOKEN is missing in your .env file.');
  console.error('Please populate your .env file with your Discord bot credentials before starting.');
  process.exit(1);
}

// Log the Lavalink connection info being used
console.log(`[Bot] Connecting to Lavalink at ${config.lavalink.host}:${config.lavalink.port}`);

client.login(config.discordToken).catch((err) => {
  console.error('[Startup Error] Failed to login to Discord:', err.message);
});
