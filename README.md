# Discord Fish Voice Bot

A persistent, privacy-first Discord voice bot written in TypeScript. Users self-enroll, Discord audio is isolated by speaker, useful 5–30 second segments are quality-scored, curated, and used to build versioned private Fish Audio voices. Generated text is not stored. Unenrollment removes enrollment/voice metadata and deactivates samples; operators should configure Fish deletion and filesystem retention according to local privacy policy.

## Architecture and behavior

`src/discord` owns slash registration and the least-privilege client; `training` owns feature extraction, multi-factor scoring, ranking, diversity curation, session isolation, and safe replacement builds; `services/fish` is the provider boundary; `live` implements bounded buffering, feedback prevention, voice switching, and measured capture/STT/TTS/buffer/total latency; `voice` serializes guild playback; `db` persists enrollment, voices, samples, generations; and `audio` safely invokes FFmpeg without a shell and cleans temporary files.

Live conversion is **STT → Fish TTS**, not true audio-to-audio conversion. Fish Audio `/v1/asr` performs speech recognition and Fish Audio `/v1/tts/live` streams MessagePack audio over WebSocket; the bounded pipeline never subscribes to the bot or other users and discards chunks older than `MAX_LIVE_LAG_MS`. Discord receive is UDP/Opus and is inherently sensitive to packet loss, NAT, server region, and Discord voice protocol changes. Mouth-to-output latency is not guessed: `/live stats` is designed to report tracker observations, and no production measurement is claimed without real credentials.

### Automatic best-sample logic

Every completed PCM segment is scored only from PCM-derived measurements: duration, detected speech/silence ratio, RMS/peak level, clipping ratio, estimated signal-to-noise ratio, and speech continuity. The bot never presents unmeasured properties as facts. After `/train stop`, each user’s highest-quality newly captured sample is posted with its measured score and reasons, audio attachment, and Accept/Reject controls; `/bestsample show` remains available for manual review.

## Discord setup

1. Create an application/bot in the Developer Portal, enable no privileged intents, and copy token/client/guild IDs into the host secret manager.
2. Invite with OAuth scopes `bot applications.commands` and permissions **View Channels, Send Messages, Connect, Speak, Attach Files** (`309237712896`). Do not grant Administrator or moderation/management permissions.
3. Start the service; guild commands register at startup. Run `/enroll` once, `/train start users:@user`, then `/train stop`. Use `/bestsample`, `/train rebuild`, `/say`, and `/live` as documented by command descriptions. Admin-wide rebuild/destructive operations should be restricted using `BOT_ADMIN_ROLE_ID`.

## Fish Audio setup

Create an API key in Fish Audio, store it only as `FISH_API_KEY`, and ensure the account may create private models and call TTS. The isolated client uses private multipart model creation, multipart `/v1/asr`, JSON `/v1/tts`, realtime WebSocket `/v1/tts/live`, and deletes failed replacement models. The ASR implementation follows the official [Speech to Text](https://docs.fish.audio/api-reference/endpoint/openapi-v1/speech-to-text) multipart contract, and live synthesis follows the official [WebSocket TTS Streaming](https://docs.fish.audio/api-reference/endpoint/websocket/tts-live) MessagePack protocol at `/v1/tts/live`. API capabilities and account limits change; confirm these references before production rollout. IDs and authorization headers are never sent to Discord or logs.

## Run and deploy

```bash
cp .env.example .env                 # fill via a secret manager; never commit it
npm install
npm run lint && npm run typecheck && npm test && npm run build
docker compose up -d
```

Before deployment, register and verify commands and exercise the real Fish API:

```bash
npm run register-commands
# Set FISH_TEST_VOICE_ID to test an existing private voice, or
# FISH_TEST_REFERENCE_FILE (+ optional transcript) to create, synthesize, and delete a test model.
npm run test:integration
```

The integration command validates that the Discord token belongs to `DISCORD_CLIENT_ID`, that the guild is accessible, that every command is visible through Discord after registration, and that Fish HTTP and realtime WebSocket TTS return non-empty audio and that realtime completion is an explicit finish(reason="stop"). When a reference file is supplied it also exercises Fish ASR, creates a private Fish model, and deletes it after synthesis. Set `FISH_TEST_OUTPUT_FILE` to retain the returned MP3 for an audible check. Voice receive, `/say` playback, and `/live` still require a human/test account in a voice channel; API credentials alone cannot originate Discord voice packets.

Required configuration: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `FISH_API_KEY`, and `DATABASE_URL` (normally `file:/data/bot.db`); all remaining documented variables have safe defaults in `.env.example`. A Railway, Fly.io, Render, or equivalent service needs one continuously running Docker instance, outbound HTTPS/Discord UDP, and a persistent volume mounted at `/data`. Never use ephemeral storage for enrollment data. Back up the SQLite database and training directory consistently.

## Operations and troubleshooting

* **Voice receive:** verify Connect/Speak/View permissions, that the invoker is in voice, UDP egress works, and only enrolled target user IDs are subscribed. Packet loss and decoder errors must finalize/discard incomplete segments rather than mix users.
* **FFmpeg:** run `ffmpeg -version`; the Docker image includes it. Spawn arguments are fixed arrays, never user shell strings.
* **Fish:** verify quota, private-model entitlement, reference format/limits, API-key scope, and regional availability. A new model is never activated until test synthesis succeeds.
* **Storage/privacy:** `/trainingdata prune` retains accepted and diverse high-score data; `/trainingdata clear` and `/unenroll` are destructive. Mount `/data`, enforces storage/count/duration caps, and clean abandoned `/data/temp` files on every startup.
* **Security:** `.env` and audio are ignored, logs redact credentials, aliases/text are validated at command boundaries, generation length is capped, requests are rate-limited, filesystem names are generated, and no arbitrary path/URL/shell execution exists.

Real Discord/Fish enrollment, capture, cloning, playback, and latency tests require secure credentials and human voice-channel participation; they are intentionally not simulated as successful when those credentials are absent.

### Fish TTS model
`FISH_TTS_MODEL` selects `s1`, `s2-pro`, `s2.1-pro`, or `s2.1-pro-free`.
`s2.1-pro-free` is the free developer-tier option and the default. Fish model
creation is independently capped at 20 curated references by
`FISH_MAX_MODEL_REFERENCES`; `MAX_SAMPLES_PER_VOICE` only limits local storage.
