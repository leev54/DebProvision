import pino from 'pino';
export const logger=pino({redact:{paths:['DISCORD_TOKEN','FISH_API_KEY','token','apiKey','authorization','headers.authorization'],censor:'[REDACTED]'}});
