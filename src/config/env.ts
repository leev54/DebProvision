import { z } from 'zod';
const bool=z.string().default('true').transform(v=>v==='true');
const num=(v:number)=>z.coerce.number().positive().default(v);
const schema=z.object({DISCORD_TOKEN:z.string().min(1),DISCORD_CLIENT_ID:z.string().min(1),DISCORD_GUILD_ID:z.string().min(1),FISH_API_KEY:z.string().min(1),DATABASE_URL:z.string().default('file:/data/bot.db'),BOT_ADMIN_ROLE_ID:z.string().optional(),MAX_TRAINING_STORAGE_MB:num(2000),MAX_SAMPLES_PER_VOICE:num(200),MAX_SELECTED_TRAINING_DURATION_SECONDS:num(600),AUTO_REBUILD:bool,AUTO_REBUILD_NEW_SPEECH_SECONDS:num(300),AUTO_KEEP_BEST_SAMPLE:bool,AUTO_SUGGEST_BEST_SAMPLE:bool,BEST_SAMPLE_MIN_SECONDS:num(8),BEST_SAMPLE_MAX_SECONDS:num(30),BEST_SAMPLE_MIN_SCORE:z.coerce.number().min(0).max(1).default(.78),LIVE_TRANSCRIPTION_CHUNK_MS:num(1000),LIVE_TTS_BUFFER_MS:num(250),MAX_LIVE_LAG_MS:num(3000),MAX_TTS_TEXT_LENGTH:num(1000)});
export type Config=z.infer<typeof schema>;
export function loadConfig(env:NodeJS.ProcessEnv=process.env):Config { return schema.parse(env); }
export function dbPath(url:string){if(!url.startsWith('file:'))throw new Error('DATABASE_URL must use file:');return url.slice(5);}
