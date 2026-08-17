import {PermissionFlagsBits,REST,Routes,SlashCommandBuilder} from 'discord.js';
const user=(name:string,description:string)=>(option:any)=>option.setName(name).setDescription(description).setRequired(true);
const string=(name:string,description:string)=>(option:any)=>option.setName(name).setDescription(description).setRequired(true);
const target=(subcommand:any)=>subcommand.addUserOption(user('user','Discord user whose voice or data to manage'));
export const commands=[
 new SlashCommandBuilder().setName('deletedata').setDescription('Delete all stored bot data for a user').addUserOption(user('user','Discord user whose data to delete')),
 new SlashCommandBuilder().setName('train').setDescription('Manage continuous isolated training').addSubcommand(s=>s.setName('start').setDescription('Start').addStringOption(string('users','Mention users to record'))).addSubcommand(s=>s.setName('stop').setDescription('Stop cleanly')).addSubcommand(s=>s.setName('status').setDescription('Status')).addSubcommand(s=>target(s.setName('rebuild').setDescription('Build the next model for a user'))).addSubcommand(s=>s.setName('rebuild-all').setDescription('Build all voices')),
 new SlashCommandBuilder().setName('say').setDescription('Speak using a saved voice').addUserOption(user('user','Discord user whose voice to use')).addStringOption(string('text','Text')).addNumberOption(o=>o.setName('speed').setDescription('Speed').setRequired(false).setMinValue(.5).setMaxValue(2)),
 ...['voices','join','leave','stop','skip','queue'].map(name=>new SlashCommandBuilder().setName(name).setDescription(`${name} voice service`)),
 new SlashCommandBuilder().setName('voiceinfo').setDescription('Show voice details').addUserOption(user('user','Discord user whose voice to inspect')),
 new SlashCommandBuilder().setName('deletevoice').setDescription('Reset a user voice').addUserOption(user('user','Discord user whose voice to reset')),
 ...['pause','start','diagnostics'].map(name=>new SlashCommandBuilder().setName(name).setDescription(name==='pause'?'Pause bot operations':name==='start'?'Resume bot operations':'Show operational status')),
 new SlashCommandBuilder().setName('trainingdata').setDescription('Manage training data').addSubcommand(s=>target(s.setName('status').setDescription('Status'))).addSubcommand(s=>target(s.setName('clear').setDescription('Clear'))).addSubcommand(s=>target(s.setName('prune').setDescription('Curate dataset'))),
 new SlashCommandBuilder().setName('bestsample').setDescription('Manage best candidates').addSubcommand(s=>target(s.setName('show').setDescription('Show'))).addSubcommand(s=>target(s.setName('accept').setDescription('Accept'))).addSubcommand(s=>target(s.setName('reject').setDescription('Reject'))).addSubcommand(s=>target(s.setName('history').setDescription('History'))),
].map(command=>command.setDefaultMemberPermissions(null).toJSON());
export async function registerCommands(token:string,clientId:string,guildId:string){const rest=new REST().setToken(token);await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commands});}
export const minimalInvitePermissions=PermissionFlagsBits.ViewChannel|PermissionFlagsBits.SendMessages|PermissionFlagsBits.Connect|PermissionFlagsBits.Speak|PermissionFlagsBits.AttachFiles;
