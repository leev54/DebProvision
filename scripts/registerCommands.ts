import { loadConfig } from '../src/config/env.js';
import { commands,registerCommands } from '../src/discord/registerCommands.js';
const config=loadConfig();
await registerCommands(config.DISCORD_TOKEN,config.DISCORD_CLIENT_ID,config.DISCORD_GUILD_ID);
console.log(`Registered ${commands.length} guild commands for ${config.DISCORD_GUILD_ID}.`);
