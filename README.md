# Discord Fish Voice Bot

A persistent, privacy-focused Discord voice bot that captures isolated Discord speakers, scores and curates managed training WAV files, builds private Fish Audio voices, and provides HTTP or realtime TTS playback. Generated text is not persisted.

## Discord control and privacy

All commands and component interactions work only in the configured `BOT_COMMAND_CHANNEL_ID` inside `DISCORD_GUILD_ID`. Discord's normal channel permissions determine who can access that channel; the bot adds no enrollment, auto-enrollment, role synchronization, or secondary user allowlist. Administrators cannot bypass the configured text-channel boundary. The text control channel and the Discord voice channel may be different.

No `/enroll` step is required. `/deletedata` deletes the invoking user's stored samples, review records, managed WAV files, voice/profile metadata, and remote Fish model in that guild. Remote deletion uses a durable cleanup outbox, so retryable Fish failures remain scheduled and permanent authentication/configuration failures remain recorded for operator diagnosis. Fish provider IDs may exist in internal cleanup records and structured logs, but are never included in Discord responses. `/deletevoice` remains a narrower operation that resets one owned voice while leaving other usable bot data in place.

`/train start users:@user` records only the explicitly selected Discord user IDs, with a separate receive stream per user. It never records the bot, unrelated members, or everybody in a voice channel. Training segments shorter than `MIN_TRAINING_SEGMENT_SECONDS` are discarded (default: 2 seconds); this is independent of best-sample eligibility. `/train stop` reports measured quality and review controls but never publicly attaches raw training WAVs. An owner can privately inspect a pending candidate with `/bestsample show`.

## Audio and model behavior

Live conversion is **Discord Opus → Fish ASR → Fish realtime TTS → Discord playback**. `MAX_LIVE_LAG_MS` is the deadline from completed utterance to first synthesized audio: capture duration is excluded, stale ASR is aborted, queue-stale work is dropped, and first-audio timeout cancels realtime generation without cutting off healthy synthesis after audio begins. Receive and playback failures are isolated so later queue items can continue.

Pending samples enter automatic model curation only at or above `MODEL_SAMPLE_MIN_SCORE`; manually accepted samples remain usable below that threshold, while rejected and inactive samples are never used. `FISH_MAX_MODEL_REFERENCES` is capped at 20 and `MAX_SELECTED_TRAINING_DURATION_SECONDS` caps selected reference duration. `AUTO_KEEP_BEST_SAMPLE` protects only the current pending best candidate from automatic eviction; it does not accept the sample.

Fish HTTP and realtime selection are independent. `FISH_TTS_MODEL` accepts `s1`, `s2-pro`, `s2.1-pro`, and `s2.1-pro-free` (default `s2.1-pro-free`). Independently, `FISH_REALTIME_MODEL` accepts only the WebSocket-documented `s1` and `s2-pro` values (default `s2-pro`). Realtime success requires non-empty audio followed by `finish(reason="stop")`. TTS speed is validated as 0.5 through 2.0 before Fish requests.

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

At startup the bot parses configuration, completes SQLite migrations, reconciles the bot-managed training directory, cleans temporary files, starts durable provider cleanup, registers commands, and logs in. Reconciliation removes only project-generated orphan WAV paths, preserves referenced WAVs, and deactivates active rows whose managed files are missing. Shutdown rejects new interactions, drains already-running interactions, then drains capture/live/playback/provider cleanup, destroys Discord, and closes SQLite last.

## Credential-dependent integration smoke

```bash
# FISH_TEST_VOICE_ID tests an existing private voice, or
# FISH_TEST_REFERENCE_FILE (+ optional FISH_TEST_REFERENCE_TEXT) creates a temporary private voice.
npm run test:integration
```

With real credentials, the script verifies Discord authentication, application ID, configured guild and command registration; Fish ASR non-empty text; HTTP TTS with `FISH_TTS_MODEL`; realtime audio and `finish(reason="stop")` with `FISH_REALTIME_MODEL`; temporary private voice creation; and durable deletion. It does not fake Discord voice receive. End-to-end Discord UDP/Opus receive, ASR, realtime synthesis, and playback still require Fish credentials plus a human/test account in a real Discord voice channel.
