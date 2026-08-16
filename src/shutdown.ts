import type {Client} from 'discord.js';import type {DB} from './db/client.js';
export interface ShutdownServices {drainInteractions():Promise<void>;stopCapture():Promise<void>;stopLive():Promise<void>;stopVoice():Promise<void>;stopProviderCleanup():Promise<void>;client:Pick<Client,'destroy'>;db:Pick<DB,'close'>}
const run=(operation:()=>unknown)=>Promise.resolve().then(operation);
export async function shutdownRuntime(services:ShutdownServices){await Promise.allSettled([run(services.drainInteractions)]);await Promise.allSettled([run(services.stopCapture),run(services.stopLive),run(services.stopVoice)]);await Promise.allSettled([run(services.stopProviderCleanup)]);try{services.client.destroy();}finally{services.db.close();}}
