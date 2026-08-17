export class PublicCommandError extends Error {
  constructor(readonly publicMessage:string){super(publicMessage);this.name='PublicCommandError';}
}
export function commandErrorMessage(error:unknown){return error instanceof PublicCommandError?error.publicMessage:'The command failed because of an internal service error.';}
export function publicError(message:string):never{throw new PublicCommandError(message);}
