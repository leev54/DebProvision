import { readFile,writeFile } from 'node:fs/promises';
import {openDatabase} from '../src/db/client.js';import {dbPath} from '../src/config/env.js';import {ProviderDeletionQueue} from '../src/services/fish/ProviderDeletionQueue.js';
import { REST,Routes } from 'discord.js';
import { loadConfig } from '../src/config/env.js';
import { commands,registerCommands } from '../src/discord/registerCommands.js';
import { FishClient } from '../src/services/fish/FishClient.js';
import { FishTranscriptionService } from '../src/services/transcription/FishTranscriptionService.js';
const config=loadConfig();const testDatabase=process.env.FISH_TEST_DATABASE_URL;if(!testDatabase?.startsWith('file:'))throw new Error('FISH_TEST_DATABASE_URL=file:... is required for isolated smoke cleanup');
const rest=new REST().setToken(config.DISCORD_TOKEN);
await registerCommands(config.DISCORD_TOKEN,config.DISCORD_CLIENT_ID,config.DISCORD_GUILD_ID);
const application=await rest.get(Routes.currentApplication()) as {id:string};
if(application.id!==config.DISCORD_CLIENT_ID)throw new Error(`DISCORD_CLIENT_ID does not match token application (${application.id})`);
await rest.get(Routes.guild(config.DISCORD_GUILD_ID));const control=await rest.get(Routes.channel(config.BOT_COMMAND_CHANNEL_ID)) as {guild_id?:string;type?:number};if(control.guild_id!==config.DISCORD_GUILD_ID||control.type!==0)throw new Error('BOT_COMMAND_CHANNEL_ID is not a guild text channel in DISCORD_GUILD_ID');
const installed=await rest.get(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID,config.DISCORD_GUILD_ID)) as {name:string}[];
if(installed.length!==commands.length)throw new Error(`Discord installed ${installed.length}/${commands.length} commands`);
console.log(`Discord authenticated; verified ${installed.length} registered guild commands.`);
const fish=new FishClient(config.FISH_API_KEY,'https://api.fish.audio',config.FISH_REALTIME_TIMEOUT_MS,config.FISH_TTS_MODEL,config.FISH_REALTIME_MODEL);
let voiceId=process.env.FISH_TEST_VOICE_ID;let created=false;
const reference=process.env.FISH_TEST_REFERENCE_FILE;
if(reference){const referenceAudio=await readFile(reference);const transcription=await new FishTranscriptionService(config.FISH_API_KEY).transcribeWav(referenceAudio);if(!transcription.text)throw new Error('Fish ASR smoke test returned no text');console.log(`Fish ASR returned ${transcription.text.length} characters.`);const model=await fish.createVoice({name:`deployment-smoke-${Date.now()}`,references:[{path:reference,...(process.env.FISH_TEST_REFERENCE_TEXT?{transcript:process.env.FISH_TEST_REFERENCE_TEXT}:{})}]});voiceId=model.id;created=true;console.log('Fish created a private temporary test model.');}
if(!voiceId)throw new Error('Set FISH_TEST_VOICE_ID or FISH_TEST_REFERENCE_FILE to run real Fish TTS');
try{const audio=await fish.synthesize({voiceId,text:'Deployment integration test successful.'});let liveBytes=0;await fish.streamSynthesize({voiceId,text:'Realtime integration test successful.'},chunk=>{liveBytes+=chunk.byteLength;});if(!liveBytes)throw new Error('Fish realtime smoke test returned no audio');console.log(`Fish realtime TTS completed with finish(stop) after ${liveBytes} audio bytes.`);const output=process.env.FISH_TEST_OUTPUT_FILE;if(output)await writeFile(output,audio);console.log(`Fish TTS returned ${audio.byteLength} bytes${output?` and wrote ${output}`:''}.`);}finally{if(created){const db=openDatabase(dbPath(testDatabase));const cleanup=new ProviderDeletionQueue(db,fish);const deleted=await cleanup.delete(voiceId);await cleanup.stopAndDrain();db.close();if(deleted!=='deleted')process.exitCode=1;}}
