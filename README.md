# Reels/TikTok/Shorts Generation

> Turning strangers' Reddit drama into vertical videos with a robot voice over Minecraft-parkour-style footage, because apparently that's what the internet wants now.

## What is this, and why does it exist?

You've scrolled past them. A calm AI voice reads *"AITA for refusing to attend my sister's wedding after she…"* over a satisfying soap-cutting video, with giant word-by-word captions bouncing in the middle of the screen. Millions of views. Zero human effort.

Well, almost zero. Somebody still had to copy the post, write the script, record the voice, cut the video, burn the captions and upload it. **This project is that somebody**, except it doesn't complain, doesn't sleep, and doesn't ask for a raise.

It runs **entirely on your own machine**: a local LLM, local TTS and local speech-to-text. No OpenAI bill, no ElevenLabs subscription, and no one judging your content strategy.

## How it works (the 30-second version)

```
Reddit (via arctic-shift)          ─┐
  or a mock JSON file               ├─►  stories table  ──►  reels table  ──►  BullMQ queue
  or a story you typed yourself    ─┘                                              │
                                                                                   ▼
                       ┌──────────── produce job (one reel at a time) ────────────┐
                       │                                                           │
                       │  1. script  →  Ollama rewrites the post as narration      │
                       │  2. tts     →  Kokoro speaks it, Whisper times each word  │
                       │  3. render  →  ffmpeg: background clip + voice + captions │
                       │  4. upload  →  YouTube Data API, straight to Shorts       │
                       └───────────────────────────────────────────────────────────┘
```

### The stages, explained for people who skip docs (hi)

| Step | What it does | Who does the actual work |
|------|--------------|--------------------------|
| **fetch** | Pulls posts from the subreddits in `REDDIT_SUBREDDITS`, throws out the removed, NSFW, too-short and too-long ones, and saves the rest to `stories`. Then it picks the top `STORIES_PER_FETCH` by score and turns them into `reels`. It remembers how far back it has paged per subreddit (`fetch_cursors`), so it never reads the same post twice. | [arctic-shift](https://arctic-shift.photon-reddit.com) (a Reddit archive, no API key needed) or `REDDIT_MOCK_FILE` |
| **script** | Rewrites the post as a ~300-word first-person story with a hook, plus a title, description, hashtags and a narrator gender. The prompt lives in `src/prompts/system.txt`; edit it if you'd like the AI to be less dramatic (it won't be). | Ollama (`OLLAMA_MODEL`) |
| **tts** | Generates the narration with a male or female voice, then runs Whisper over the audio to get timestamps for every word, so the captions actually line up. Revolutionary, we know. | Kokoro TTS + whisper.cpp |
| **render** | Picks a random background clip from `ASMR_DIR`, starts it at a random offset, crops it to 1080×1920, burns in the captions and muxes in the voice. | ffmpeg |
| **upload** | Posts the result to YouTube with `YT_PRIVACY` (start with `private`, trust us). | YouTube Data API v3 |

Each step writes its result to a column on the `reels` row (`story`, `audio_path`, `video_path`, `youtube_id`). If a reel fails at step 3, a retry skips steps 1 and 2 instead of re-running them. Yes, someone thought about that.

The worker runs with `concurrency: 1`, so reels are made **one at a time**. That's on purpose: your GPU is already running an LLM, a TTS model and Whisper, and it would like a word with you.

> **There is no cron anymore.** The daily auto-fetch was removed. On startup the app actively deletes any old `fetch` scheduler left in Redis. Nothing happens until you ask it to (see the API section below).

## Setup

### What you need

Linux, Node 20.12+ (for `process.loadEnvFile`), 8 GB of RAM or more (see [the model](#the-model-or-how-this-runs-on-a-potato)), and patience. `setup.sh` installs or starts the rest:

- **Ollama**, plus a model alias (`OLLAMA_MODEL` copied from `OLLAMA_SOURCE_MODEL`)
- **Kokoro TTS server** (cloned to `KOKORO_DIR`, started with `just start`)
- **whisper.cpp** (built from source) and a model file
- **Redis** for the BullMQ queue
- **Postgres** for stories and reels
- **ffmpeg**, obviously

```bash
npm run setup      # installs and starts everything above; safe to re-run
npm run migrate    # creates the tables
```

Put at least one background video (`.mp4`, `.mov`, `.mkv`, `.webm`) in `ASMR_DIR`, or the render step will fail and tell you so.

### The model (or: how this runs on a potato)

The script step uses a **Q4_K_M quantized Qwen 8B**: about 2.8 GB on disk, small enough to run on an **8 GB RAM** machine without the OOM killer turning up:

**https://huggingface.co/Anand1711/qwen_8b_quantized_model**

`setup.sh` pulls it straight from Hugging Face through Ollama and gives it a short local alias:

```bash
ollama pull hf.co/Anand1711/qwen_8b_quantized_model:Q4_K_M   # OLLAMA_SOURCE_MODEL
ollama cp   hf.co/Anand1711/qwen_8b_quantized_model:Q4_K_M qwen-reel   # OLLAMA_MODEL
```

Ollama is called with `keep_alive: 0`, so the model is unloaded after every script. That frees the RAM for Kokoro, Whisper and ffmpeg, at the cost of a few seconds of loading per reel. On 8 GB you don't get to have everything at once. Welcome to budget AI.

### Configuration (`.env`)

Start from the sample: `cp .env.development .env` (`setup.sh` does this for you if `.env` is missing), then fill in the DB password, the YouTube client ID and secret, and your local Kokoro and Whisper paths. The sample has comments and working defaults for everything else, including the model above and `REDDIT_MOCK_FILE` so you can test without touching the internet.

`.env` is git-ignored. Never commit it, unless you enjoy rotating credentials. `.env.development` is the sample and **is** committed, so keep real secrets out of it.

| Group | Variables |
|-------|-----------|
| Server | `PORT` |
| Database | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| Queue | `REDIS_HOST`, `REDIS_PORT` |
| Stories | `REDDIT_SUBREDDITS` (comma-separated), `REDDIT_PAGE_SIZE`, `REDDIT_MAX_PAGES`, `REDDIT_MIN_CHARS`, `REDDIT_MAX_CHARS`, `STORIES_PER_FETCH`, `ARCTIC_SHIFT_URL`, `REDDIT_MOCK_FILE` (if set, reads this file instead of the internet) |
| LLM | `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_SOURCE_MODEL`, `MIN_WORDS`, `MAX_WORDS` |
| Voice | `KOKORO_URL`, `KOKORO_DIR`, `KOKORO_REPO`, `KOKORO_VOICE_MALE`, `KOKORO_VOICE_FEMALE`, `KOKORO_SPEED` |
| Captions | `WHISPER_BIN`, `WHISPER_MODEL`, `WORDS_PER_CAPTION`, `CAPTION_FONT`, `CAPTION_SIZE` |
| Video | `ASMR_DIR`, `AUDIO_DIR`, `SUBS_DIR`, `VIDEO_DIR`, `MAX_SECONDS` (narration longer than this fails the render; nobody is watching a 4-minute short) |
| YouTube | `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REDIRECT_URI`, `YT_TOKEN_PATH`, `YT_PRIVACY` |

## Running it

```bash
npm run dev          # nodemon, for when you're tinkering
npm start            # plain node

# production, via pm2 (see ecosystem.config.cjs)
npm run pm2:start
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
pm2 save && pm2 startup   # once, so it survives reboots
```

The API and the worker run in **one process**, and pm2 is set to **one instance**. Don't scale it to `max` cores "for performance". You'll just get several processes fighting over the same GPU and still finish nothing.

Logs are one line per event, tagged by reel, so you can follow a video's whole life in the terminal:

```
18:41:02 [reel 0b3a33c1] tts: requesting narration from <KOKORO_URL>/say (voice <KOKORO_VOICE_FEMALE>)
```

## Connecting YouTube

1. In Google Cloud Console, create an OAuth client (type "Web application") and enable **YouTube Data API v3**.
2. Add `http://localhost:<PORT>/auth/youtube/callback` as an authorized redirect URI, and set the same value as `YT_REDIRECT_URI`.
3. Start the app and open `http://localhost:<PORT>/auth/youtube` in a browser.
4. Approve access. You'll see "YouTube connected", and the token is saved to `YT_TOKEN_PATH`.

On a remote server, tunnel the port first: `ssh -L <PORT>:localhost:<PORT> user@server`.

If uploads mysteriously start failing after about a week: while your OAuth consent screen is in **Testing** mode, Google expires refresh tokens after 7 days. Publish the app to "In production", or redo step 3 every week like it's a chore.

## API

| Method | Path | What it does |
|--------|------|--------------|
| `GET` | `/health` | `{ ok: true }`. Riveting stuff. |
| `GET` | `/reels?status=` | Last 100 reels, optionally filtered by `pending`, `processing`, `done` or `failed` |
| `GET` | `/reels/:id` | One reel, with every artifact path and error message |
| `POST` | `/reels/fetch` | Fetch stories and queue a batch of reels. **This replaces the old cron.** |
| `POST` | `/reels/fetch/custom_job` | Skip Reddit and bring your own drama: `{ "title": "...", "story": "..." }` |
| `POST` | `/reels/:id/retry` | Re-queue a failed reel; steps that already finished are skipped |
| `GET` | `/auth/youtube` | Starts the OAuth dance |
| `GET` | `/auth/youtube/callback` | Where Google sends you back |

```bash
curl -X POST localhost:$PORT/reels/fetch
curl -X POST localhost:$PORT/reels/fetch/custom_job \
  -H 'content-type: application/json' \
  -d '{"title":"AITA for microwaving fish at work?","story":"..."}'
```

Deleting rows from `reels` and `stories` is **blocked by a database trigger**. That's not a bug, it's a seatbelt. Drop the trigger if you really, truly mean it.

## Project layout

```
src/
  index.js          boots express + worker, cleans up the old cron scheduler
  routes.js         the API above
  worker.js         fetch + produce jobs, the step pipeline
  queue.js          BullMQ queue + redis connection
  services/
    reddit.js       arctic-shift / mock fetching + filtering
    llm.js          ollama script writer (structured JSON output)
    tts.js          kokoro narration + whisper word alignment
    captions.js     builds the .ass subtitle file
    render.js       ffmpeg compositing
    youtube.js      oauth + upload
  prompts/system.txt  the storyteller prompt
migrations/         knex migrations (reels, stories, delete-blocking triggers)
mock/stories.json   offline story fixtures
media/              asmr clips in, audio/subs/video out
```

## Making it actually awesome: a video diffusion model

Right now every reel looks the same: a story about a toxic mother-in-law plays over a hydraulic press crushing crayons. Viewers have noticed. The algorithm has noticed. Your one subscriber (also you) has noticed.

The fix is a **video generation model** (diffusion or similar, e.g. Wan, HunyuanVideo, LTX-Video, CogVideoX, or a hosted API if your GPU starts crying) that makes visuals that match what's actually being said.

### How it would slot in

The pipeline is already a list of steps in `src/worker.js`, so adding one is mostly boring, which is the best kind of change:

```js
const steps = [
  ['script', 'story',      llm.writeScript],
  ['scenes', 'scenes',     llm.writeScenePrompts],   // new: story → timed visual prompts
  ['tts',    'audio_path', tts.speak],
  ['visuals','clips_dir',  diffusion.generate],      // new: prompts → short clips
  ['render', 'video_path', render.render],            // now stitches generated clips instead of a random ASMR file
  ['upload', 'youtube_id', youtube.upload],
];
```

1. **Scene prompts.** Ask the LLM to split the story into 6–10 beats, each with a visual prompt (*"a woman staring at a wedding invitation in a dim kitchen, cinematic, vertical"*). Line them up with Whisper's word timestamps, which we already have, so each clip lasts exactly as long as its sentence.
2. **Generate clips.** Send each prompt to the video model at 9:16, roughly 3–5 seconds per beat. Keep a consistent style and seed so the main character doesn't change ethnicity, age and species between scenes.
3. **Render.** Swap the random-ASMR-clip input in `render.js` for an ffmpeg concat of the generated clips, with light crossfades. Captions and audio stay exactly as they are.
4. **Fallback.** If generation fails or takes too long, fall back to the current ASMR clip. A boring video still beats a missing one.

### Why bother

- **Retention:** visuals that match the narration keep people watching past the first 3 seconds, which is the only metric that matters (sadly).
- **Not looking like 40,000 other channels** that use the same Subway Surfers footage.
- **Fewer reuse flags:** YouTube is increasingly unimpressed by "reused content". Footage generated for each story is, well, unique.

### The catch (there's always a catch)

- **GPU time:** a 60-second short could take far longer to generate than everything else in the pipeline put together. The single-worker setup helps here: one reel at a time means one diffusion job at a time.
- **VRAM:** you probably can't keep the LLM, Kokoro, Whisper *and* a video model loaded at once. `llm.js` already unloads Ollama after each call (`keep_alive: 0`); do the same for the video model.
- **Consistency:** characters drifting between clips is still the hardest unsolved problem in this space. Lean on style-heavy, character-light prompts (hands, objects, rooms, silhouettes) until the models get better.
- **Disclosure:** uploads already set `containsSyntheticMedia: true`. Keep it that way.

## FAQ

**Is this ethical?** It sets the synthetic-media flag, it rewrites rather than copies, and it filters out NSFW and removed posts. Whether the world needs more AI Reddit shorts is a question for philosophers and your own conscience.

**Why is my reel stuck in `processing`?** The process was stopped or restarted mid-reel. The startup log lists these; `POST /reels/:id/retry` them.

**Can it run faster?** Buy a better GPU.
