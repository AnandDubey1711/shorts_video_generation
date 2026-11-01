import { Worker } from 'bullmq';
import db from './db.js';
import { queue, connection } from './queue.js';
import * as reddit from './services/reddit.js';
import * as llm from './services/llm.js';
import * as tts from './services/tts.js';
import * as render from './services/render.js';
import * as youtube from './services/youtube.js';
import { log, reelTag, secondsSince } from './log.js';

const steps = [
  ['script', 'story', llm.writeScript],
  ['tts', 'audio_path', tts.speak],
  ['render', 'video_path', render.render],
  ['upload', 'youtube_id', youtube.upload],
];

async function update(id, data) {
  const [reel] = await db('reels').where({ id }).update({ ...data, updated_at: db.fn.now() }).returning('*');
  return reel;
}

const utcTime = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');

// pages each subreddit further back in time until the pool gains `needed` stories; fetch_cursors remembers where each page ended
async function refill(needed) {
  let added = 0;
  for (let page = 1; page <= Number(process.env.REDDIT_MAX_PAGES) && added < needed; page++) {
    let fetched = 0;
    for (const subreddit of process.env.REDDIT_SUBREDDITS.split(',')) {
      const cursor = await db('fetch_cursors').where({ subreddit }).first();
      const from = cursor ? `before ${utcTime(cursor.before_utc)} UTC` : 'newest';
      const posts = await reddit.fetchPage(subreddit, cursor?.before_utc);
      if (!posts.length) {
        log('fetch', `r/${subreddit} ${from}: no more posts`);
        continue;
      }
      fetched += posts.length;
      const stories = posts.map(reddit.toStory).filter(Boolean);
      const rows = stories.length ? await db('stories').insert(stories).onConflict(['source', 'source_id']).ignore().returning('id') : [];
      added += rows.length;
      const before = Math.min(...posts.map((p) => p.created_utc));
      await db('fetch_cursors').insert({ subreddit, before_utc: before, updated_at: db.fn.now() }).onConflict('subreddit').merge();
      log('fetch', `r/${subreddit} ${from}: ${posts.length} posts, ${stories.length} passed checks, ${rows.length} new`);
    }
    if (!fetched) break;
  }
  return added;
}

async function fetchStories(title = "", story = "") {
if (!title && !story) {
  const cohort = Number(process.env.STORIES_PER_FETCH);
  const available = Number((await db('stories').whereNull('picked_at').count({ n: '*' }).first()).n);
  log('fetch', `${available} unpicked stories in the pool, cohort of ${cohort} (STORIES_PER_FETCH)`);
  if (available < cohort) {
    log('fetch', `refilling from ${process.env.REDDIT_MOCK_FILE ? `mock file ${process.env.REDDIT_MOCK_FILE}` : process.env.ARCTIC_SHIFT_URL}`);
    log('fetch', `refill added ${await refill(cohort - available)} stories`);
  }
  const rows = await db.transaction(async (trx) => {
    const stories = await trx('stories')
      .whereNull('picked_at')
      .orderBy([{ column: 'score', order: 'desc' }, { column: 'created_utc', order: 'desc' }])
      .limit(cohort);
    if (!stories.length) return [];
    await trx('stories').whereIn('id', stories.map((s) => s.id)).update({ picked_at: trx.fn.now() });
    const reels = stories.map(({ source, source_id, original_title, original_text }) => ({ source, source_id, original_title, original_text }));
    return trx('reels').insert(reels).onConflict(['source', 'source_id']).ignore().returning('id');
  });
  await queue.addBulk(rows.map((row) => ({ name: 'produce', data: { id: row.id } })));
  for (const row of rows) log(reelTag(row.id), `queued (full id ${row.id})`);
  return { added: rows.length };
} else {
  let added = null;
  added = await customStoryInsertion(title, story);
  return added;
}
}

function pKeyGen() {
  let arr = [];
  let arr2 = [];
  let str = "";
  for (let i = 65; i < 91; i++) {
    arr.push(String.fromCharCode(i));
    arr2.push(i);;
  }

  for (let i = 0; i < 3; i++) {
    str += arr2[Math.floor(Math.random() * 10)]
    let ch = arr[Math.floor(Math.random() * 10)]
    ch = Math.random() < 0.5 ? ch.toLowerCase() : ch.toUpperCase()
    str += ch;
  }

  return str;
}

async function customStoryInsertion(title, story) {
  try {
    if (!title || !story) {
      return;
    }

    const row = await db.transaction(async (trx) => {
      const max_id = await trx("stories").max("id").first();
      const nextId = Number(max_id.max ?? Math.floor(Math.random()*10e9)) + 1;
      const pKey = pKeyGen();
        const entryItem = { "id": nextId + 1, source: "custom", "source_id": pKey, subreddit: "AmItheAsshole", "original_title": title, "original_text": story, "score": Number(Math.random().toFixed(1))*10+1, "created_utc": Math.floor(Date.now() / 1000) };

        await trx("stories").insert(entryItem).onConflict(['source', 'source_id']).ignore().returning('id');
        
        const reelEntryItem = { source: "custom", "source_id": pKey, "original_title": title, "original_text": story };

        return trx("reels").insert(reelEntryItem).onConflict(["source", "source_id"]).ignore().returning("id")
    })
    const [jobId] = row;
    if(jobId.id){
      const job = await queue.add('produce', { id: jobId.id });
    }
    return { "added": jobId.id ? 1: 0 }
  } catch (error) {
    console.log("Something went wrong", error);
  }
}

async function produce(id) {
  const tag = reelTag(id);
  const started = Date.now();
  let reel = await update(id, { status: 'processing', failed_step: null, error: null });
  log(tag, `started "${reel.original_title}"`);
  for (const [name, field, run] of steps) {
    if (reel[field]) {
      log(tag, `${name}: already done, skipping`);
      continue;
    }
    log(tag, `${name}: started`);
    const stepStarted = Date.now();
    try {
      reel = await update(id, await run(reel));
      log(tag, `${name}: done in ${secondsSince(stepStarted)}`);
    } catch (err) {
      log(tag, `${name}: FAILED after ${secondsSince(stepStarted)} - ${err.message}`);
      await update(id, { status: 'failed', failed_step: name, error: err.message });
      throw err;
    }
  }
  await update(id, { status: 'done' });
  log(tag, `all steps done in ${secondsSince(started)}`);
}

export function startWorker() {
  const worker = new Worker('reels', (job) => (job.name === 'fetch' ? fetchStories(job?.data?.title, job?.data?.story) : produce(job.data.id)), {
    connection,
    concurrency: 1,
  });
  worker.on('active', (job) => job.name === 'fetch' && log('fetch', 'started'));
  worker.on('completed', (job) => job.name === 'fetch' && log('fetch', `done, ${job.returnvalue.added} new reel(s) queued`));
  worker.on('failed', (job, err) => log(job?.data?.id ? reelTag(job.data.id) : 'queue', `${job?.name} job failed: ${err.message}`));
  worker.on('error', (err) => log('queue', `worker error: ${err.message}`));
  return worker;
}