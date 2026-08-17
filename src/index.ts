import {loadConfig,dbPath} from './config/env.js';
import {openDatabase} from './db/client.js';
import {VoiceRepository} from './db/repositories/VoiceRepository.js';
import {SampleRepository} from './db/repositories/SampleRepository.js';
import {StateRepository} from './db/repositories/StateRepository.js';
import {registerCommands} from './discord/registerCommands.js';
import {createDiscordClient,drainDiscordInteractions,enableDiscordInteractions} from './discord/client.js';
import {TempFiles} from './audio/tempFiles.js';
import {logger} from './utils/logger.js';
import {FishClient} from './services/fish/FishClient.js';
import {DiscordVoiceRuntime} from './voice/DiscordVoiceRuntime.js';
import {VoiceCaptureService} from './voice/VoiceCaptureService.js';
import {TrainingSessionManager} from './training/TrainingSessionManager.js';
import {VoiceModelBuilder} from './training/VoiceModelBuilder.js';
import {ProviderDeletionQueue} from './services/fish/ProviderDeletionQueue.js';
import {DatasetCurator} from './training/DatasetCurator.js';
import {shutdownRuntime} from './shutdown.js';
import {ManagedStorageCleanup} from './services/ManagedStorageCleanup.js';
import {BackupService} from './services/BackupService.js';
import {ModelReadinessRepository} from './db/repositories/ModelReadinessRepository.js';
import {StorageCoordinator} from './services/StorageCoordinator.js';
import {YtDlpMusicSourceResolver} from './music/YtDlpMusicSourceResolver.js';

async function main(){
  process.umask(0o077);const startedAt=Date.now(),config=loadConfig(),db=openDatabase(dbPath(config.DATABASE_URL));let closed=false,shuttingDown=false,cleanup=async()=>{if(closed)return;closed=true;db.close();};
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void(async()=>{if(shuttingDown)return;shuttingDown=true;logger.info({signal},'graceful shutdown started');await cleanup();logger.info({signal},'graceful shutdown complete');process.exit(0)})());
  const repo=new VoiceRepository(db),samples=new SampleRepository(db),state=new StateRepository(db),readiness=new ModelReadinessRepository(db),storage=new StorageCoordinator();repo.reconcileStaged();await samples.cleanupQueuedFiles();await samples.reconcileManagedStorage();
  const temp=new TempFiles();await temp.init();const fish=new FishClient(config.FISH_API_KEY,'https://api.fish.audio',config.FISH_HTTP_TIMEOUT_MS,config.FISH_TTS_MODEL),providerDeletions=new ProviderDeletionQueue(db,fish),localCleanup=new ManagedStorageCleanup(samples,'/data/training',10*60_000,storage),voice=new DiscordVoiceRuntime(),capture=new VoiceCaptureService('/data/training',undefined,undefined,config.MAX_TRAINING_SEGMENT_SECONDS*1000,bytes=>samples.reserveStorage(bytes,config.MAX_TRAINING_STORAGE_MB*1024*1024),config.MIN_TRAINING_SEGMENT_SECONDS*1000,storage),training=new TrainingSessionManager(),builder=new VoiceModelBuilder(fish,id=>providerDeletions.delete(id),new DatasetCurator(config.MODEL_SAMPLE_MIN_SCORE),config.FISH_MAX_MODEL_REFERENCES,config.MAX_SELECTED_TRAINING_DURATION_SECONDS,id=>repo.stageProvider(id),id=>repo.clearStaged(id),'/data/training',config.FISH_MAX_MODEL_UPLOAD_MB*1024*1024),music=new YtDlpMusicSourceResolver(),backups=new BackupService(db,state,config.BACKUP_DIRECTORY,config.BACKUP_RETENTION_COUNT,'/data',storage),client=createDiscordClient(config,repo,{samples,fish,voice,capture,training,builder,providerDeletions,state,readiness,music,storage,db,startedAt},false);
  cleanup=async()=>{if(closed)return;closed=true;await backups.stopAndDrain();await shutdownRuntime({drainInteractions:()=>drainDiscordInteractions(client),stopCapture:()=>capture.stopAllAndDrain(),stopLive:async()=>{},stopVoice:async()=>{await Promise.all([voice.stopAll(),music.stopAll()]);},stopLocalCleanup:()=>localCleanup.stopAndDrain(),stopProviderCleanup:()=>providerDeletions.stopAndDrain(),client,db});};
  try{await client.login(config.DISCORD_TOKEN);await client.guilds.fetch(config.DISCORD_GUILD_ID);await registerCommands(config.DISCORD_TOKEN,config.DISCORD_CLIENT_ID,config.DISCORD_GUILD_ID);providerDeletions.start();localCleanup.start();backups.start(config.BACKUP_INTERVAL_MINUTES*60_000);enableDiscordInteractions(client);logger.info({paused:state.isPaused()},'bot started');}catch(error){await cleanup();throw error;}
}
main().catch(error=>{logger.fatal({err:error},'startup failed');process.exitCode=1});
