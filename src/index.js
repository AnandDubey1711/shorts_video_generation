import './env.js'; // must stay first: loads .env before other modules read process.env
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import routes from './routes.js';
import { queue } from './queue.js';
import { startWorker } from './worker.js';
import db from './db.js';
import { log } from './log.js';

for (const dir of [process.env.ASMR_DIR, process.env.AUDIO_DIR, process.env.SUBS_DIR, process.env.VIDEO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(routes);

log('startup', `llm ${process.env.OLLAMA_MODEL}, tts ${process.env.KOKORO_URL}, stories from ${process.env.REDDIT_MOCK_FILE || process.env.ARCTIC_SHIFT_URL}, daily fetch "${process.env.FETCH_CRON}"`);
// checked before the worker starts, so anything 'processing' here was cut off by a previous stop or restart
const stuck = await db('reels').where({ status: 'processing' }).pluck('id');
for (const id of stuck) log('startup', `reel ${id} was left mid-way by the last run - if it doesn't show up below, re-queue it with POST /reels/${id}/retry`);

startWorker();
queue.upsertJobScheduler('fetch', { pattern: process.env.FETCH_CRON }, { name: 'fetch' });

app.listen(process.env.PORT, () => log('startup', `listening on http://localhost:${process.env.PORT}`));
