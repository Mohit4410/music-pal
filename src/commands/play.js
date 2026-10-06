import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { validateVoiceState } from '../utils/voiceValidator.js';
import { formatDuration } from '../utils/formatters.js';
import { isSpotifyUrl, resolveSpotifyUrl } from '../utils/spotify.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Plays audio from Spotify, SoundCloud, YouTube, or direct audio URLs')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('Song title, artist, or URL (Spotify, SoundCloud, YouTube)')
      .setRequired(true)
  );

/**
 * Searches audio stream using SoundCloud first, with an automatic YouTube fallback.
 * @param {import('moonlink.js').Manager} manager
 * @param {string} textQuery
 * @param {import('discord.js').User} user
 * @returns {Promise<{ res: import('moonlink.js').SearchResult, source: string }>}
 */
async function searchAudioWithFallback(manager, textQuery, user) {
  // 1. Try SoundCloud search first (high-fidelity audio stream)
  try {
    const scRes = await manager.search({
      query: textQuery,
      source: 'soundcloud',
      requester: user,
    });

    if (scRes && !scRes.isEmpty && !scRes.isError && scRes.tracks?.length > 0) {
      return { res: scRes, source: 'SoundCloud' };
    }
  } catch (scErr) {
    console.warn(`[Search] SoundCloud search failed for "${textQuery}":`, scErr.message);
  }

  // 2. Automatic YouTube fallback when SoundCloud yields 0 results or errors
  console.log(`[Search Fallback] No tracks on SoundCloud for "${textQuery}". Falling back to YouTube...`);
  try {
    const ytRes = await manager.search({
      query: textQuery,
      source: 'youtube',
      requester: user,
    });

    if (ytRes && !ytRes.isEmpty && !ytRes.isError && ytRes.tracks?.length > 0) {
      return { res: ytRes, source: 'YouTube' };
    }
  } catch (ytErr) {
    console.error(`[Search Fallback] YouTube search failed for "${textQuery}":`, ytErr.message);
  }

  // If both failed, return empty result
  return { res: null, source: 'None' };
}

/**
 * Common play handler shared between slash command and prefix fallback.
 * @param {object} params
 * @param {import('discord.js').GuildMember} params.member
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').TextBasedChannel} params.channel
 * @param {import('discord.js').User} params.user
 * @param {string} params.query
 * @param {import('moonlink.js').Manager} params.manager
 * @param {function} params.respond
 */
export async function handlePlayRequest({ member, guild, channel, user, query, manager, respond }) {
  // 1. Validate voice channel & permissions
  const validation = validateVoiceState(member, guild, manager);
  if (!validation.valid) {
    return respond({ embeds: [validation.errorEmbed], ephemeral: true });
  }

  const voiceChannel = validation.voiceChannel;

  // 2. Get or create high-fidelity Lavalink player
  let player = manager.players.get(guild.id);
  if (!player) {
    player = manager.players.create({
      guildId: guild.id,
      voiceChannelId: voiceChannel.id,
      textChannelId: channel.id,
      volume: 100, // Locked to 100% (gain = 1.0) for bit-perfect audio
      selfDeaf: true,
      selfMute: false,
    });
  } else {
    player.setTextChannelId(channel.id);
    if (player.voiceChannelId !== voiceChannel.id) {
      player.setVoiceChannelId(voiceChannel.id);
    }
  }

  // Enforce 100% volume gain lock
  if (player.volume !== 100) {
    player.setVolume(100);
  }

  // 3. Connect to voice channel if not connected
  if (!player.connected) {
    await player.connect({ selfDeaf: true, selfMute: false });
  }

  const rawInput = query.trim();
  const isDirectUrl = /^https?:\/\//i.test(rawInput);

  // ==========================================
  // CASE A: SPOTIFY URL (Tracks, Albums, Playlists)
  // ==========================================
  if (isSpotifyUrl(rawInput)) {
    const spotifyData = await resolveSpotifyUrl(rawInput);

    if (spotifyData && spotifyData.tracks?.length > 0) {
      // A1: Single Spotify Track
      if (spotifyData.type === 'track') {
        const item = spotifyData.tracks[0];
        const { res, source } = await searchAudioWithFallback(manager, item.searchQuery, user);

        if (!res || !res.tracks || res.tracks.length === 0) {
          const notFoundEmbed = new EmbedBuilder()
            .setColor(0xfee75c)
            .setDescription(`🔍 Could not find an audio stream matching: **${item.title}** by **${item.author}**`);
          return respond({ embeds: [notFoundEmbed], ephemeral: true });
        }

        const track = res.tracks[0];
        if (item.artworkUrl) track.artworkUrl = item.artworkUrl;

        const wasPlaying = player.playing || player.paused;
        player.queue.add(track);

        if (!wasPlaying) {
          await player.play();
          const embed = new EmbedBuilder()
            .setColor(0x1db954)
            .setTitle('▶️ Playing Now (via Spotify)')
            .setDescription(`**[${item.title}](${item.url})**\nArtist: \`${item.author}\``)
            .addFields(
              { name: 'Duration', value: formatDuration(track.duration, track.isStream), inline: true },
              { name: 'Stream Audio', value: `${source} (Opus 48kHz)`, inline: true },
              { name: 'Gain', value: '100% Bit-Perfect', inline: true }
            )
            .setThumbnail(item.artworkUrl || track.artworkUrl || null)
            .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

          return respond({ embeds: [embed] });
        } else {
          const embed = new EmbedBuilder()
            .setColor(0x1db954)
            .setTitle('📥 Added to Queue (via Spotify)')
            .setDescription(`**[${item.title}](${item.url})**\nArtist: \`${item.author}\``)
            .addFields(
              { name: 'Duration', value: formatDuration(track.duration, track.isStream), inline: true },
              { name: 'Queue Position', value: `#${player.queue.size}`, inline: true },
              { name: 'Source', value: `${source} Audio`, inline: true }
            )
            .setThumbnail(item.artworkUrl || track.artworkUrl || null)
            .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

          return respond({ embeds: [embed] });
        }
      }

      // A2: Spotify Playlist or Album
      if (spotifyData.type === 'playlist' || spotifyData.type === 'album') {
        const typeLabel = spotifyData.type === 'album' ? 'Album' : 'Playlist';
        const totalItems = spotifyData.tracks.length;

        // Resolve first track immediately so playback begins with minimal delay
        const firstItem = spotifyData.tracks[0];
        const { res: firstRes } = await searchAudioWithFallback(manager, firstItem.searchQuery, user);

        if (firstRes?.tracks?.length > 0) {
          const t = firstRes.tracks[0];
          if (firstItem.artworkUrl) t.artworkUrl = firstItem.artworkUrl;
          player.queue.add(t);

          if (!player.playing && !player.paused) {
            await player.play();
          }
        }

        // Asynchronously enqueue remaining tracks in background
        (async () => {
          for (let i = 1; i < Math.min(totalItems, 100); i++) {
            const item = spotifyData.tracks[i];
            try {
              const { res: nextRes } = await searchAudioWithFallback(manager, item.searchQuery, user);
              if (nextRes?.tracks?.length > 0) {
                const trk = nextRes.tracks[0];
                if (item.artworkUrl) trk.artworkUrl = item.artworkUrl;
                player.queue.add(trk);
              }
            } catch (queueErr) {
              // Continue loading subsequent tracks
            }
          }
        })();

        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setTitle(`📂 Queued Spotify ${typeLabel}`)
          .setDescription(`Enqueued **${totalItems}** tracks from **${spotifyData.name}**`)
          .addFields(
            { name: 'Type', value: `Spotify ${typeLabel}`, inline: true },
            { name: 'Playback Engine', value: 'Lavalink v4 Opus 48kHz (Bit-Perfect)', inline: true }
          )
          .setThumbnail(spotifyData.artworkUrl || null)
          .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

        return respond({ embeds: [embed] });
      }
    }
  }

  // ==========================================
  // CASE B: DIRECT URL (SoundCloud, YouTube, Bandcamp, Direct Audio)
  // ==========================================
  if (isDirectUrl) {
    let res;
    try {
      res = await manager.search({
        query: rawInput,
        requester: user,
      });
    } catch (urlErr) {
      console.error('[Play Command] Direct URL load error:', urlErr);
    }

    if (!res || res.isEmpty || !res.tracks || res.tracks.length === 0) {
      const notFoundEmbed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setDescription(`🔍 Could not load media from URL:\n${rawInput}`);
      return respond({ embeds: [notFoundEmbed], ephemeral: true });
    }

    if (res.isError) {
      const errorEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Audio Decode Error')
        .setDescription(`Failed to decode URL audio stream:\n\`\`\`${res.exception?.message || 'Unknown stream error'}\`\`\``);
      return respond({ embeds: [errorEmbed], ephemeral: true });
    }

    // Direct Playlist / Set
    if (res.isPlaylist) {
      const playlistName = res.playlistInfo?.name || 'Audio Playlist';
      const tracks = res.tracks;
      const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);

      player.queue.add(tracks);

      if (!player.playing && !player.paused) {
        await player.play();
      }

      const embed = new EmbedBuilder()
        .setColor(0xff5500)
        .setTitle('📂 Queued Playlist')
        .setDescription(`Enqueued **${tracks.length}** tracks from [${playlistName}](${rawInput})`)
        .addFields(
          { name: 'Total Length', value: formatDuration(totalDuration), inline: true },
          { name: 'Queue Size', value: `${player.queue.size}`, inline: true },
          { name: 'Fidelity', value: '48kHz Opus Direct Stream', inline: true }
        )
        .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

      return respond({ embeds: [embed] });
    }

    // Direct Single Track
    const track = res.tracks[0];
    const wasPlaying = player.playing || player.paused;
    player.queue.add(track);

    if (!wasPlaying) {
      await player.play();
      const embed = new EmbedBuilder()
        .setColor(0xff5500)
        .setTitle('▶️ Playing Now')
        .setDescription(`[${track.title}](${track.url || rawInput})`)
        .addFields(
          { name: 'Artist', value: track.author || 'Unknown', inline: true },
          { name: 'Duration', value: formatDuration(track.duration, track.isStream), inline: true },
          { name: 'Audio Pipeline', value: `${track.sourceName || 'Direct'} ➔ Lavalink v4 Opus`, inline: false }
        )
        .setThumbnail(track.artworkUrl || null)
        .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

      return respond({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📥 Added to Queue')
        .setDescription(`[${track.title}](${track.url || rawInput})`)
        .addFields(
          { name: 'Artist', value: track.author || 'Unknown', inline: true },
          { name: 'Duration', value: formatDuration(track.duration, track.isStream), inline: true },
          { name: 'Queue Position', value: `#${player.queue.size}`, inline: true }
        )
        .setThumbnail(track.artworkUrl || null)
        .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

      return respond({ embeds: [embed] });
    }
  }

  // ==========================================
  // CASE C: PLAIN TEXT SEARCH (SoundCloud with YouTube Fallback)
  // ==========================================
  let textQuery = rawInput;
  let forceSource = null;

  if (textQuery.startsWith('scsearch:')) {
    textQuery = textQuery.slice(9).trim();
    forceSource = 'soundcloud';
  } else if (textQuery.startsWith('ytsearch:')) {
    textQuery = textQuery.slice(9).trim();
    forceSource = 'youtube';
  }

  let res;
  let usedSource;

  if (forceSource) {
    res = await manager.search({ query: textQuery, source: forceSource, requester: user });
    usedSource = forceSource === 'soundcloud' ? 'SoundCloud' : 'YouTube';
  } else {
    const outcome = await searchAudioWithFallback(manager, textQuery, user);
    res = outcome.res;
    usedSource = outcome.source;
  }

  // Handle empty or error states
  if (!res || res.isEmpty || !res.tracks || res.tracks.length === 0) {
    const notFoundEmbed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setDescription(`🔍 No audio tracks found across SoundCloud or YouTube for: **${rawInput}**`);
    return respond({ embeds: [notFoundEmbed], ephemeral: true });
  }

  if (res.isError) {
    const errorEmbed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Search Error')
      .setDescription(`Audio search failed:\n\`\`\`${res.exception?.message || 'Unknown stream error'}\`\`\``);
    return respond({ embeds: [errorEmbed], ephemeral: true });
  }

  // Enqueue first search result
  const track = res.tracks[0];
  const wasPlaying = player.playing || player.paused;

  player.queue.add(track);

  if (!wasPlaying) {
    await player.play();
    const embed = new EmbedBuilder()
      .setColor(usedSource === 'SoundCloud' ? 0xff5500 : 0xff0000)
      .setTitle('▶️ Playing Now')
      .setDescription(`[${track.title}](${track.url || 'https://soundcloud.com'})`)
      .addFields(
        { name: 'Artist', value: track.author || 'Unknown', inline: true },
        { name: 'Duration', value: formatDuration(track.duration, track.isStream), inline: true },
        { name: 'Audio Pipeline', value: `${usedSource} ➔ Lavalink v4 Opus (Bit-Perfect)`, inline: false }
      )
      .setThumbnail(track.artworkUrl || null)
      .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

    return respond({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📥 Added to Queue')
      .setDescription(`[${track.title}](${track.url || 'https://soundcloud.com'})`)
      .addFields(
        { name: 'Artist', value: track.author || 'Unknown', inline: true },
        { name: 'Duration', value: formatDuration(track.duration, track.isStream), inline: true },
        { name: 'Source', value: `${usedSource} Audio`, inline: true },
        { name: 'Queue Position', value: `#${player.queue.size}`, inline: true }
      )
      .setThumbnail(track.artworkUrl || null)
      .setFooter({ text: `Requested by ${user.tag}`, iconURL: user.displayAvatarURL() });

    return respond({ embeds: [embed] });
  }
}

/**
 * Slash Command Execution
 */
export async function execute(interaction, client, manager) {
  await interaction.deferReply();
  const query = interaction.options.getString('query', true).trim();

  await handlePlayRequest({
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    user: interaction.user,
    query,
    manager,
    respond: (data) => interaction.editReply(data),
  });
}

/**
 * Text Prefix Execution (!play <query>)
 */
export async function executePrefix(message, args, client, manager) {
  const query = args.join(' ').trim();
  if (!query) {
    const usageEmbed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setDescription('⚠️ Usage: `!play <Song name, SoundCloud URL, YouTube Link, or Spotify URL>`');
    return message.reply({ embeds: [usageEmbed] });
  }

  const replyMsg = await message.reply('🔍 Searching audio stream...');

  await handlePlayRequest({
    member: message.member,
    guild: message.guild,
    channel: message.channel,
    user: message.author,
    query,
    manager,
    respond: (data) => replyMsg.edit(data),
  });
}
