# Discord Fish Voice Bot

A persistent, privacy-first Discord voice bot written in TypeScript. Users self-enroll, Discord audio is isolated by speaker, useful 5–30 second segments are quality-scored, curated, and used to build versioned private Fish Audio voices. Generated text is not stored. Unenrollment removes enrollment/voice metadata and deactivates samples; operators should configure Fish deletion and filesystem retention according to local privacy policy.

## Architecture and behavior

`src/discord` owns slash registration and the least-privilege client; `training` owns feature extraction, multi-factor scoring, ranking, diversity curation, session isolation, and safe replacement builds; `services/fish` is the provider boundary; `live` implements bounded buffering, feedback prevention, voice switching, and measured capture/STT/TTS/buffer/total latency; `voice` serializes guild playback; `db` persists enrollment, voices, samples, generations; and `audio` safely invokes FFmpeg without a shell and cleans temporary files.

Live conversion is **STT → Fish TTS**, not true audio-to-audio conversion. A deployment must supply a streaming transcription implementation compatible with its region/provider before live audio can be transcribed; the bounded pipeline never subscribes to the bot or other users and discards chunks older than `MAX_LIVE_LAG_MS`. Discord receive is UDP/Opus and is inherently sensitive to packet loss, NAT, server region, and Discord voice protocol changes. Mouth-to-output latency is not guessed: `/live stats` is designed to report tracker observations, and no production measurement is claimed without real credentials.

### Automatic best-sample logic

Every completed PCM segment is measured for duration, actual voiced/silence ratio, RMS and peak, clipping, estimated SNR, packet discontinuity, overlap, transcription confidence/word count, continuity, music likelihood, naturalness, and novelty. The normalized weighted score is: duration 16%, speech ratio 17%, loudness consistency 8%, SNR 13%, clipping 10%, overlap 10%, packet integrity 6%, transcription 5%, continuity 5%, non-music 4%, naturalness 4%, novelty 2%. Under-5s/over-30s audio is multiplied by 0.45 and speech below 35% by 0.5. Top candidates are ranked per owner; novelty rejects near-equivalent duration/RMS candidates. Exceptional means score ≥0.92, 10–30s, speech >75%, clipping <0.2%, and overlap <8%. Accepted best samples are selected first, followed by high-quality diverse samples, within configured count/duration limits. Replacement models are synthesized/tested before atomic DB activation; failed replacements are deleted and the working voice survives.

## Discord setup

1. Create an application/bot in the Developer Portal, enable no privileged intents, and copy token/client/guild IDs into the host secret manager.
2. Invite with OAuth scopes `bot applications.commands` and permissions **View Channels, Send Messages, Connect, Speak, Attach Files** (`309237712896`). Do not grant Administrator or moderation/management permissions.
3. Start the service; guild commands register at startup. Run `/enroll` once, `/train start users:@user`, then `/train stop`. Use `/bestsample`, `/train rebuild`, `/say`, and `/live` as documented by command descriptions. Admin-wide rebuild/destructive operations should be restricted using `BOT_ADMIN_ROLE_ID`.

## Fish Audio setup

Create an API key in Fish Audio, store it only as `FISH_API_KEY`, and ensure the account may create private models and call TTS. The isolated client uses private multipart model creation, JSON `/v1/tts`, and deletes failed replacement models. API capabilities and account limits change; confirm request formats against the current official Fish Audio API reference before production rollout. IDs and authorization headers are never sent to Discord or logs.

## Run and deploy

```bash
cp .env.example .env                 # fill via a secret manager; never commit it
npm install
npm run lint && npm run typecheck && npm test && npm run build
docker compose up -d
```

Required secrets: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, and `FISH_API_KEY`. `DATABASE_URL` defaults to `file:/data/bot.db`; all remaining documented variables have safe defaults in `.env.example`. A Railway, Fly.io, Render, or equivalent service needs one continuously running Docker instance, outbound HTTPS/Discord UDP, and a persistent volume mounted at `/data`. Never use ephemeral storage for enrollment data. Back up the SQLite database and training directory consistently.

## Operations and troubleshooting

* **Voice receive:** verify Connect/Speak/View permissions, that the invoker is in voice, UDP egress works, and only enrolled target user IDs are subscribed. Packet loss and decoder errors must finalize/discard incomplete segments rather than mix users.
* **FFmpeg:** run `ffmpeg -version`; the Docker image includes it. Spawn arguments are fixed arrays, never user shell strings.
* **Fish:** verify quota, private-model entitlement, reference format/limits, API-key scope, and regional availability. A new model is never activated until test synthesis succeeds.
* **Storage/privacy:** `/trainingdata prune` retains accepted and diverse high-score data; `/trainingdata clear` and `/unenroll` are destructive. Mount `/data`, cap storage/count/duration, and clean abandoned `/data/temp` files on every startup.
* **Security:** `.env` and audio are ignored, logs redact credentials, aliases/text are validated at command boundaries, generation length is capped, requests are rate-limited, filesystem names are generated, and no arbitrary path/URL/shell execution exists.

Real Discord/Fish enrollment, capture, cloning, playback, and latency tests require secure credentials and human voice-channel participation; they are intentionally not simulated as successful when those credentials are absent.
