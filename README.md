# Discord Fish Voice Bot

A persistent, privacy-focused Discord voice bot that captures isolated Discord speakers, scores and curates managed training WAV files, builds private Fish Audio voices, and provides HTTP or realtime TTS playback. Generated text is not persisted.

## Discord control and privacy

All commands and component interactions work only in the configured `BOT_COMMAND_CHANNEL_ID` inside `DISCORD_GUILD_ID`. Discord's normal channel permissions determine who can access that channel; the bot adds no enrollment, auto-enrollment, role synchronization, or secondary user allowlist. Administrators cannot bypass the configured text-channel boundary. The text control channel and the Discord voice channel may be different.

No `/enroll` step is required. `/deletedata` deletes the invoking user's stored samples, review records, managed WAV files, voice/profile metadata, and remote Fish model in that guild. Remote deletion uses a durable cleanup outbox, so retryable Fish failures remain scheduled and permanent authentication/configuration failures remain recorded for operator diagnosis. Fish provider IDs may exist in internal cleanup records and structured logs, but are never included in Discord responses. `/deletevoice` remains a narrower operation that resets one owned voice while leaving other usable bot data in place.

`/train start users:@user` records at most `MAX_TRAINING_TARGETS` (default 8) explicitly selected non-bot guild members who are currently in the same voice channel. It records only the explicitly selected Discord user IDs, with a separate receive stream per user. It never records the bot, unrelated members, or everybody in a voice channel. Training segments shorter than `MIN_TRAINING_SEGMENT_SECONDS` are discarded (default: 2 seconds); this is independent of best-sample eligibility. `/train stop` reports measured quality and review controls but never publicly attaches raw training WAVs. An owner can privately inspect a pending candidate with `/bestsample show`.

## Audio and model behavior

Live conversion is **Discord Opus → Fish ASR → Fish realtime TTS → Discord playback**. `MAX_LIVE_LAG_MS` is the deadline from completed utterance to first synthesized audio: capture duration is excluded, stale ASR is aborted, queue-stale work is dropped, and first-audio timeout cancels realtime generation without cutting off healthy synthesis after audio begins. Receive and playback failures are isolated so later queue items can continue.

Pending samples enter automatic model curation only at or above `MODEL_SAMPLE_MIN_SCORE`; manually accepted samples remain usable below that threshold, while rejected and inactive samples are never used. `FISH_MAX_MODEL_REFERENCES` is capped at 20 and `MAX_SELECTED_TRAINING_DURATION_SECONDS` caps selected reference duration. `AUTO_KEEP_BEST_SAMPLE` protects only the current pending best candidate from automatic eviction; it does not accept the sample.

Fish HTTP and realtime selection are independent. `FISH_TTS_MODEL` accepts `s1`, `s2-pro`, `s2.1-pro`, and `s2.1-pro-free` (default `s2.1-pro-free`). Independently, `FISH_REALTIME_MODEL` accepts `s1`, `s2-pro`, `s2.1-pro`, and `s2.1-pro-free` (default `s2-pro`). Realtime success requires non-empty audio followed by `finish(reason="stop")`. TTS speed is validated as 0.5 through 2.0 before Fish requests.

## Setup and operation

Required settings are `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `BOT_COMMAND_CHANNEL_ID`, `FISH_API_KEY`, and `DATABASE_URL` (normally `file:/data/bot.db`). Store secrets in a secret manager; Fish authorization headers are never logged. Mount persistent storage at `/data` and back up the SQLite database and training directory consistently.

1. Create a Discord application and bot without privileged intents.
2. Invite it with `bot applications.commands` and **View Channels, Send Messages, Connect, Speak, Attach Files** permissions. Grant access to the dedicated control channel using ordinary Discord channel permissions.
3. Configure `.env`, start the service, then use `/train start users:@user`, `/train stop`, `/bestsample`, `/train rebuild`, `/say`, and `/live` from the control channel.

```bash
cp .env.example .env
npm ci
npm run lint && npm run typecheck && npm run typecheck:test && npm test && npm run build
docker compose up -d
```

At startup the bot parses configuration, completes SQLite migrations and managed-storage reconciliation, authenticates Discord, validates the configured control channel, registers commands, then enables cleanup workers and interaction processing. Reconciliation removes only project-generated orphan WAV paths, preserves referenced WAVs, and deactivates active rows whose managed files are missing. Shutdown rejects new interactions, drains already-running interactions, then drains capture/live/playback/provider cleanup, destroys Discord, and closes SQLite last.

## Credential-dependent integration smoke

```bash
# FISH_TEST_VOICE_ID tests an existing private voice, or
# FISH_TEST_REFERENCE_FILE (+ optional FISH_TEST_REFERENCE_TEXT) creates a temporary private voice.
FISH_TEST_DATABASE_URL=file:/data/fish-smoke.db npm run test:integration
```

With real credentials, the script verifies Discord authentication, application ID, configured guild, control channel, and command registration. ASR is verified only when `FISH_TEST_REFERENCE_FILE` is supplied. With `FISH_TEST_VOICE_ID`, HTTP TTS with `FISH_TTS_MODEL`; realtime audio and `finish(reason="stop")` with `FISH_REALTIME_MODEL`; temporary private voice creation when reference audio is supplied; and durable deletion using isolated `FISH_TEST_DATABASE_URL`. It does not fake Discord voice receive. End-to-end Discord UDP/Opus receive, ASR, realtime synthesis, and playback still require Fish credentials plus a human/test account in a real Discord voice channel.

## Operator and deployment model

Everyone whom Discord permits to use the dedicated `BOT_COMMAND_CHANNEL_ID` is a trusted operator for shared operations such as `/say`, `/live`, and model rebuilds. Owner-only inspection, rename, review, and deletion operations remain owner-restricted. `/train start` performs only practical capture validation: targets are deduplicated guild members, must be non-bot users in the invoker's voice channel, and are capped by `MAX_TRAINING_TARGETS` (default 8). Profiles are created lazily after the complete target list passes validation; no enrollment, role allowlist, or per-target text-channel permission system exists.

Playback labels and normal logs contain request metadata and character counts, never raw `/say` text or ASR transcripts. Deleted personal sample/review metadata is removed transactionally; only path-safe WAV cleanup work remains in a durable minimal outbox and is retried periodically without waiting for restart.

For Railway, mount a persistent volume at `/data`, set `DATABASE_URL=file:/data/bot.db`, and keep `MAX_TRAINING_STORAGE_MB` below volume capacity with a safety margin. Supply Discord/Fish secrets and `BOT_COMMAND_CHANNEL_ID`. The image normally runs as UID 10001; if the mounted volume is not writable by that UID, Railway may require `RAILWAY_RUN_UID=0`. Configure a nonzero `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` long enough for Fish requests and runtime cleanup to drain. CI cannot prove mounted-volume ownership. Discord voice receive is not a formally stable public receive API, so real Fish credentials and human Discord voice traffic remain required for end-to-end runtime validation.

### Runtime lifecycle notes

Startup authenticates Discord and validates the configured guild/control channel and bot permissions before command registration, background cleanup workers, or interaction acceptance are enabled. A failed startup explicitly drains initialized services, destroys Discord, and closes SQLite. HTTP Fish operations use `FISH_HTTP_TIMEOUT_MS`, ASR uses `FISH_ASR_TIMEOUT_MS`, and realtime WebSocket synthesis uses `FISH_REALTIME_TIMEOUT_MS`.

Privacy deletion removes personal sample/review metadata transactionally and places only managed WAV paths in a minimal durable local-cleanup outbox. Physical deletion is path-validated and retried periodically. Files still being admitted are protected from reconciliation until repository admission completes.

Run exactly one bot replica against a given SQLite database and Discord bot token. Do not use overlapping Railway replicas against the same `/data/bot.db`; multi-instance operation requires a different coordination/storage architecture.

Fish model creation and SQLite staging cannot form a distributed transaction. If the process dies after Fish creates a model but before Fish returns/persists its ID, that remote resource cannot be recovered safely without a provider idempotency or scoped reconciliation API.

### Durable cleanup and concurrency notes

SQLite is the single-replica coordination source. Personal sample deletion records managed WAV paths in a local-file cleanup outbox before metadata is removed; orphan reconciliation excludes those owned paths and the periodic worker retries them without bypassing backoff. Provider deletion intents created by model replacement or destructive commands begin held, are armed only after live runtime coordination, and become recoverable after a crash-recovery grace period. Live model switches cancel only that live session's playback group, leaving unrelated `/say` playback intact. `/trainingdata clear` and `prune` require training to be stopped. Files attached or uploaded as model references must resolve under the generated managed-training namespace; external and symlink-escaped paths are quarantined and never deleted. Fish model creation necessarily has a small distributed-system window between Fish returning an ID and the first successful local staging write; if SQLite staging fails while the process remains alive, direct best-effort Fish deletion is attempted.

Provider cleanup rows created by destructive or replacement transactions remain held until runtime users have stopped or switched; `armAndAttempt` is the only immediate destructive path, while crash-abandoned holds become eligible after the recovery grace period. Model-scoped `/say` generations and queued audio are cancelled before deleting that model. Live group cancellation is awaitable, so an old realtime producer fully exits before its provider model is deleted, without disturbing unrelated playback. Permanently unsafe local cleanup paths are quarantined for operator diagnosis rather than retried or deleted; periodic cleanup logs only aggregate failure counts.
