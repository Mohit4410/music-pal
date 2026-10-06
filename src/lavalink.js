import { Manager, Connectors } from 'moonlink.js';
import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { createTrackEmbed } from './utils/formatters.js';

/**
 * Initializes and wires the Lavalink Moonlink manager to the Discord client.
 * @param {import('discord.js').Client} client 
 * @returns {Manager}
 */
export function createLavalinkManager(client) {
  const manager = new Manager({
    nodes: [
      {
        host: config.lavalink.host,
        port: config.lavalink.port,
        password: config.lavalink.password,
        secure: config.lavalink.secure,
        identifier: 'lavalink-v4-main',
        retryAmount: 10,
        retryDelay: 5000,
      },
    ],
    options: {
      search: {
        defaultPlatform: 'soundcloud',
      },
      defaultPlayer: {
        volume: config.defaultVolume, // 100% gain lock (gain = 1.0)
        selfDeaf: true,
        selfMute: false,
      },
      voiceConnection: {
        timeout: 15000,
        maxReconnectAttempts: 5,
        reconnectDelay: 3000,
        autoReconnect: true,
      },
      node: {
        selectionStrategy: 'leastLoad',
        retryDelay: 5000,
        retryAmount: 10,
        avoidUnhealthyNodes: true,
      },
    },
  });

  // Attach the official Discord.js v14 connector
  manager.use(new Connectors.DiscordJs(), client);

  // --- Lavalink Node Lifecycle Events ---
  manager.on('nodeCreate', (node) => {
    console.log(`[Lavalink] Node initialized: ${node.identifier} (${node.host}:${node.port})`);
  });

  manager.on('nodeConnected', (node) => {
    console.log(`[Lavalink] Successfully connected to node: ${node.identifier}`);
  });

  manager.on('nodeReady', (node, info) => {
    console.log(`[Lavalink] Node ready for playback: ${node.identifier} (Lavalink v${info?.version || '4.x'})`);
  });

  manager.on('nodeReconnect', (node) => {
    console.log(`[Lavalink] Successfully reconnected to node: ${node.identifier}`);
  });

  manager.on('nodeReconnecting', (node, attempt) => {
    console.warn(`[Lavalink] Attempting reconnection to node ${node.identifier} (Attempt #${attempt})...`);
  });

  manager.on('nodeDisconnect', (node, code, reason) => {
    console.warn(`[Lavalink] Node disconnected: ${node.identifier} (Code: ${code}, Reason: ${reason || 'Unknown'})`);
  });

  manager.on('nodeError', (node, error) => {
    console.error(`[Lavalink Error] Node ${node.identifier} encountered an error:`, error?.message || error);
  });

  // --- Playback & Queue Lifecycle Events ---
  manager.on('trackStart', async (player, track) => {
    if (!player.textChannelId) return;
    const channel = client.channels.cache.get(player.textChannelId);
    if (!channel || !channel.isTextBased()) return;

    // Enforce gain lock at 100% for bit-transparent fidelity
    if (player.volume !== 100) {
      player.setVolume(100);
    }

    try {
      const embed = createTrackEmbed(track, '🎶 Now Playing', 0);
      await channel.send({ embeds: [embed] });
    } catch (err) {
      console.error(`[Lavalink] Failed to send trackStart message in channel ${player.textChannelId}:`, err);
    }
  });

  manager.on('trackEnd', (player, track, reason) => {
    // Standard completion causes Moonlink to auto-play the next queued track
    console.log(`[Lavalink] Track ended for guild ${player.guildId}: "${track?.title}" (Reason: ${reason})`);
  });

  manager.on('trackStuck', async (player, track, threshold) => {
    console.warn(`[Lavalink] Track stuck for ${threshold}ms in guild ${player.guildId}: "${track?.title}". Attempting recovery.`);
    if (player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel && channel.isTextBased()) {
        channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setDescription(`⚠️ Audio decoder momentarily stalled on **${track?.title}**. Auto-recovering...`),
          ],
        }).catch(() => {});
      }
    }
  });

  manager.on('trackException', async (player, track, exception) => {
    console.error(`[Lavalink Error] Track exception in guild ${player.guildId} for "${track?.title}":`, exception);
    if (player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel && channel.isTextBased()) {
        channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle('Playback Error')
              .setDescription(`❌ Failed to decode audio for **${track?.title || 'Unknown Track'}**:\n\`\`\`${exception?.message || 'Source stream unreachable'}\`\`\``),
          ],
        }).catch(() => {});
      }
    }
  });

  manager.on('queueEnd', async (player) => {
    console.log(`[Lavalink] Queue ended for guild ${player.guildId}`);
    if (player.textChannelId) {
      const channel = client.channels.cache.get(player.textChannelId);
      if (channel && channel.isTextBased()) {
        channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setDescription('🏁 All tracks in the queue have finished playing.'),
          ],
        }).catch(() => {});
      }
    }
  });

  return manager;
}
