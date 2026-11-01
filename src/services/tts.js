import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { fetch, Agent } from 'undici';
import { buildAss } from './captions.js';
import { duration } from './render.js';
import { log, reelTag, secondsSince } from '../log.js';

const run = promisify(execFile);
// kokoro answers only once the whole narration is generated; the server's timeout_seconds decides when to give up, not node's 300s default
const kokoro = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

async function transcribe(audioPath) {
  const base = audioPath.replace(/\.wav$/, '.whisper');
  await run('ffmpeg', ['-y', '-v', 'error', '-i', audioPath, '-ar', '16000', '-ac', '1', `${base}.wav`]);
  await run(process.env.WHISPER_BIN, ['-m', process.env.WHISPER_MODEL, '-f', `${base}.wav`, '-ml', '1', '-sow', '-oj', '-of', base, '-np']);
  const { transcription } = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  fs.unlinkSync(`${base}.wav`);
  fs.unlinkSync(`${base}.json`);
  return transcription
    .map((s) => ({ text: norm(s.text), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }))
    .filter((w) => w.text);
}

// match script words to whisper's words (LCS), so captions keep the script's spelling with whisper's timing
function align(text, heard, seconds) {
  const words = text.split(/\s+/).filter(Boolean);
  const a = words.map(norm);
  const b = heard.map((h) => h.text);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const times = new Array(words.length);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] && a[i] === b[j]) times[i++] = heard[j++];
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const matched = times.filter(Boolean).length;
  // unmatched words (numbers, misheard words) share the gap between their matched neighbours by length
  for (let i = 0; i < words.length; ) {
    if (times[i]) { i++; continue; }
    let k = i;
    while (k < words.length && !times[k]) k++;
    const from = times[i - 1]?.end ?? 0;
    const to = Math.max(from, times[k]?.start ?? seconds);
    const total = words.slice(i, k).reduce((sum, w) => sum + w.length, 0);
    for (let t = from; i < k; i++) {
      const d = ((to - from) * words[i].length) / total;
      times[i] = { start: t, end: t + d };
      t += d;
    }
  }
  return { matched, timestamps: words.map((word, i) => ({ word, start_time: times[i].start, end_time: times[i].end })) };
}

export async function speak(reel) {
  const tag = reelTag(reel.id);
  const voice = reel.narrator_gender === 'male' ? process.env.KOKORO_VOICE_MALE : process.env.KOKORO_VOICE_FEMALE;
  let started = Date.now();
  log(tag, `tts: requesting narration from ${process.env.KOKORO_URL}/say (voice ${voice})`);
  const res = await fetch(`${process.env.KOKORO_URL}/say`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: reel.story, voice }),
    dispatcher: kokoro,
  });
  if (!res.ok) throw new Error(`kokoro ${res.status}: ${await res.text()}`);
  if (!res.headers.get('content-type')?.startsWith('audio/')) {
    throw new Error(`kokoro returned ${res.headers.get('content-type')}: ${await res.text()}`);
  }
  const audioPath = path.resolve(process.env.AUDIO_DIR, `${reel.id}.wav`);
  const subsPath = path.resolve(process.env.SUBS_DIR, `${reel.id}.ass`);
  const rawPath = path.resolve(process.env.AUDIO_DIR, `${reel.id}.raw.wav`);
  const audio = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(rawPath, audio);
  const speed = Number(process.env.KOKORO_SPEED) || 1;
  log(tag, `tts: got ${Math.round(audio.length / 1024)} KB of audio in ${secondsSince(started)}, applying ${speed}x speed`);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', rawPath, '-filter:a', `atempo=${speed}`, audioPath]);
  fs.unlinkSync(rawPath);
  started = Date.now();
  log(tag, `tts: timing words with whisper`);
  const [heard, seconds] = await Promise.all([transcribe(audioPath), duration(audioPath)]);
  const { matched, timestamps } = align(reel.story, heard, seconds);
  fs.writeFileSync(subsPath, buildAss(timestamps));
  log(tag, `tts: ${seconds.toFixed(1)}s of narration, whisper took ${secondsSince(started)} and matched ${matched}/${timestamps.length} script words, captions written`);
  return { voice, audio_path: audioPath, subs_path: subsPath };
}
