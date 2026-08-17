export class PublicCommandError extends Error {
  constructor(readonly publicMessage:string){super(publicMessage);this.name='PublicCommandError';}
}
const safePrefixes=[
  'Voice ','Output voice ','Training ','Live mode ','Provide at least ','At most ',
  'The bot ','You must ','This bot ','That sample ','No sample ','Text is too long',
  'The TTS queue ','TTS request ','Stop training ','Built voice ','Guild-only command',
  'Slow down ','Nothing is ','Join a voice channel','Playback queue is full'
];
export function commandErrorMessage(error:unknown){
  if(error instanceof PublicCommandError)return error.publicMessage;
  if(error instanceof Error&&safePrefixes.some(prefix=>error.message.startsWith(prefix)))return error.message;
  return 'The command failed because of an internal service error.';
}
