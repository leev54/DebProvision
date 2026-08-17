import {describe,expect,it} from 'vitest';
import {commands} from './registerCommands.js';
import {isConfiguredGuild,validateTrainingTargets} from './client.js';
import {loadConfig} from '../config/env.js';
import {openDatabase} from '../db/client.js';
import {VoiceRepository} from '../db/repositories/VoiceRepository.js';

const option=(command:string,subcommand?:string)=>{const root=commands.find(item=>item.name===command)!;return subcommand?(root.options as any[]).find(item=>item.name===subcommand).options:root.options as any[];};
describe('Discord user-id command UX',()=>{
 it('requires one command channel and administrator in the configured guild',()=>{const config=loadConfig({DISCORD_TOKEN:'x',DISCORD_CLIENT_ID:'123456789012346',DISCORD_GUILD_ID:'123456789012345',ADMIN_USER_ID:'234567890123456',COMMAND_CHANNEL_ID:'345678901234567',FISH_API_KEY:'x',DATABASE_URL:'file:/tmp/x'} as NodeJS.ProcessEnv);expect(isConfiguredGuild(config.DISCORD_GUILD_ID,config.DISCORD_GUILD_ID)).toBe(true);expect(config.COMMAND_CHANNEL_ID).toBe('345678901234567')});
 it('registers controls without live',()=>{const names=commands.map(x=>x.name);expect(names).toEqual(expect.arrayContaining(['pause','start','diagnostics']));expect(names).not.toContain('live')});
 it.each([['say',undefined,'user'],['voiceinfo',undefined,'user'],['deletevoice',undefined,'user'],['deletedata',undefined,'user'],['train','rebuild','user'],['bestsample','show','user'],['bestsample','accept','user'],['trainingdata','clear','user'],['trainingdata','prune','user']] as const)('%s %s selects a Discord user', (command,sub,name)=>expect(option(command,sub).find((item:any)=>item.name===name)?.type).toBe(6));
 it('does not register renamevoice and lists no alias selector',()=>{expect(commands.some(command=>command.name==='renamevoice')).toBe(false);expect(JSON.stringify(commands)).not.toContain('Voice alias')});
 it('keeps identical and hostile display names distinct by stable owner ID',()=>{const db=openDatabase(':memory:'),repo=new VoiceRepository(db);repo.ensureProfile('guild','111111111111111');repo.ensureProfile('guild','222222222222222');expect(repo.voiceByOwner('guild','111111111111111').id).not.toBe(repo.voiceByOwner('guild','222222222222222').id);expect(repo.voiceByOwner('guild','111111111111111').owner_id).toBe('111111111111111');db.close()});
 it('strictly parses training mentions without display-name lookup',async()=>{const fetch=async(id:string)=>({id,displayName:'Аlice',user:{bot:false},voice:{channelId:'voice'}});await expect(validateTrainingTargets('<@111111111111111>, <@222222222222222>',{members:{fetch}},undefined,8,'voice')).resolves.toHaveLength(2);await expect(validateTrainingTargets('@Alice',{members:{fetch}},undefined)).rejects.toThrow('only Discord @mentions')});
});
