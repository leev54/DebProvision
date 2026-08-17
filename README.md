# DebProvision

A single-guild Discord voice bot backed by Fish Audio and persistent SQLite storage. It captures isolated training WAV samples, curates them using measured quality, builds replacement Fish voice models safely, and provides queued `/say` playback.

## Configuration

Copy `.env.example` and set the required values:

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` identify the Discord bot and its one guild.
- `ADMIN_USER_ID` is the exact Discord snowflake of the one bot administrator. Discord roles and Discord's Administrator permission do not grant this access.
- `COMMAND_CHANNEL_ID` is the exact snowflake of the one text channel in which every command is allowed.
- `FISH_API_KEY` configures Fish Audio.
- `DATABASE_URL` must be a persistent `file:` URL (Railway should use `file:/data/bot.db`).

All commands reject interactions outside the configured guild or command channel. Normal members may use ordinary commands in that channel. `/deletedata`, `/deletevoice`, `/pause`, and `/start` are restricted to `ADMIN_USER_ID`.

## Commands

Training and playback commands are `/train start|stop|status|rebuild|rebuild-all`, `/trainingdata status|clear|prune`, `/bestsample show|accept|reject|history`, `/say`, `/voices`, `/voiceinfo`, `/join`, `/leave`, `/stop`, `/skip`, and `/queue`.

Administrative controls:

- `/pause` persists a paused state, cancels/drains capture and playback through the normal lifecycle, and leaves Discord connected.
- `/start` clears that persisted state. It is the only command accepted while paused.
- `/diagnostics` reports bot/Discord/SQLite/Fish status, uptime, storage and free space, cleanup queues, active training, voice count, backup state, and safe error information. It never includes tokens, API keys, request text, transcripts, or connection strings.

The paused state lives in SQLite and therefore survives process restarts, Railway restarts, and redeploys when `/data` is mounted persistently.

## Dataset readiness

Samples retain the existing score, review state, Fish reference-count limit, and selected-duration rules. As qualifying samples arrive, DebProvision fingerprints the eligible dataset and marks the model **rebuild ready** in `/trainingdata status`. A successful existing rebuild records that exact fingerprint. The same unchanged dataset is not marked as a new rebuild again; a changed qualifying dataset becomes ready. Rebuild execution remains explicit so provider staging, replacement coordination, and durable deletion guarantees are preserved.

## Backups

`BACKUP_INTERVAL_MINUTES` (default `1440`), `BACKUP_RETENTION_COUNT` (default `7`), and `BACKUP_DIRECTORY` (default `/data/backups`) control automatic local snapshots. SQLite's online backup API creates a consistent database snapshot; managed training WAVs and a restore manifest are stored beside it in an atomically published directory. Failed backups are logged and recorded for `/diagnostics` without stopping the bot. Retention deletes only older completed backup directories.

Backups remain on the mounted persistent volume. No external backup destination is integrated because the project has no external-storage credentials; diagnostics makes this explicit. For disaster recovery outside Railway's volume, operators should copy completed backup directories to storage they control. Backups contain bot state and managed audio, but no environment secrets.

## Railway and operation

Deploy the `Dockerfile` as one replica and mount a persistent volume at `/data`. Configure every required variable above in Railway. Startup performs migrations and storage reconciliation before accepting commands. Graceful shutdown drains interactions, capture, playback, backup work, and cleanup workers before Discord and SQLite close.

Run locally with `npm ci`, then `npm run dev`. Register commands separately with `npm run register-commands` if needed; normal production startup also registers the exact guild command set.

## Validation

Use `npm run lint`, `npm run typecheck`, `npm run typecheck:test`, `npm test`, `npm run build`, and `docker build -t debprovision:validation .`.
