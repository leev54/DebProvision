import { readFile,writeFile } from 'node:fs/promises';
import { REST,Routes } from 'discord.js';
import { loadConfig } from '../src/config/env.js';
import { commands,registerCommands } from '../src/discord/registerCommands.js';
import { FishClient } from '../src/services/fish/FishClient.js';
const config=loadConfig();
const rest=new REST().setToken(config.DISCORD_TOKEN);
await registerCommands(config.DISCORD_TOKEN,config.DISCORD_CLIENT_ID,config.DISCORD_GUILD_ID);
const application=await rest.get(Routes.currentApplication()) as {id:string};
if(application.id!==config.DISCORD_CLIENT_ID)throw new Error(`DISCORD_CLIENT_ID does not match token application (${application.id})`);
await rest.get(Routes.guild(config.DISCORD_GUILD_ID));
const installed=await rest.get(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID,config.DISCORD_GUILD_ID)) as {name:string}[];
if(installed.length!==commands.length)throw new Error(`Discord installed ${installed.length}/${commands.length} commands`);
console.log(`Discord authenticated; verified ${installed.length} registered guild commands.`);
const fish=new FishClient(config.FISH_API_KEY);
let voiceId=process.env.FISH_TEST_VOICE_ID;let created=false;
const reference=process.env.FISH_TEST_REFERENCE_FILE;
if(reference){await readFile(reference);const model=await fish.createVoice({name:`deployment-smoke-${Date.now()}`,references:[{path:reference,transcript:process.env.FISH_TEST_REFERENCE_TEXT}]});voiceId=model.id;created=true;console.log(`Fish created private test model ${voiceId}.`);}
if(!voiceId)throw new Error('Set FISH_TEST_VOICE_ID or FISH_TEST_REFERENCE_FILE to run real Fish TTS');
try{const audio=await fish.synthesize({voiceId,text:'Deployment integration test successful.'});const output=process.env.FISH_TEST_OUTPUT_FILE;if(output)await writeFile(output,audio);console.log(`Fish TTS returned ${audio.byteLength} bytes${output?` and wrote ${output}`:''}.`);}finally{if(created)await fish.deleteVoice(voiceId);}
