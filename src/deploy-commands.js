import { REST, Routes } from 'discord.js';
import { config, validateConfig } from './config.js';

// Import command definitions
import * as playCommand from './commands/play.js';
import * as skipCommand from './commands/skip.js';
import * as stopCommand from './commands/stop.js';
import * as queueCommand from './commands/queue.js';
import * as nowplayingCommand from './commands/nowplaying.js';
import * as pauseCommand from './commands/pause.js';
import * as resumeCommand from './commands/resume.js';
import * as setprefixCommand from './commands/setprefix.js';

validateConfig();

if (!config.discordToken || !config.clientId) {
  console.error('[Deploy Error] DISCORD_TOKEN and CLIENT_ID are required in .env to deploy commands.');
  console.error('Please configure your .env file with your Discord Application credentials.');
  process.exit(1);
}

const commands = [
  playCommand.data.toJSON(),
  skipCommand.data.toJSON(),
  stopCommand.data.toJSON(),
  queueCommand.data.toJSON(),
  nowplayingCommand.data.toJSON(),
  pauseCommand.data.toJSON(),
  resumeCommand.data.toJSON(),
  setprefixCommand.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(config.discordToken);

async function deploy() {
  try {
    console.log(`[Deploy] Refreshing ${commands.length} application (/) commands...`);

    if (config.guildId) {
      console.log(`[Deploy] Registering commands to development guild: ${config.guildId}`);
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands }
      );
      console.log(`[Deploy] Successfully registered commands to test guild! (Instant propagation)`);
    } else {
      console.log(`[Deploy] Registering commands globally...`);
      await rest.put(
        Routes.applicationCommands(config.clientId),
        { body: commands }
      );
      console.log(`[Deploy] Successfully registered application commands globally! (May take up to 1 hour to propagate to all servers)`);
    }
  } catch (error) {
    console.error('[Deploy Error] Failed to register slash commands:', error);
    process.exit(1);
  }
}

deploy();
