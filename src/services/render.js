import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { log, reelTag } from '../log.js';

const run = promisify(execFile);

export async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(stdout);
}

export async function render(reel) {
  const clips = fs.readdirSync(process.env.ASMR_DIR).filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f));
  if (!clips.length) throw new Error(`no clips in ${process.env.ASMR_DIR}`);
  const clip = path.resolve(process.env.ASMR_DIR, clips[Math.floor(Math.random() * clips.length)]);
  const [audioLength, clipLength] = await Promise.all([duration(reel.audio_path), duration(clip)]);
  if (audioLength > Number(process.env.MAX_SECONDS)) throw new Error(`audio too long: ${audioLength}s`);
  const start = Math.max(0, Math.random() * (clipLength - audioLength));
  const output = path.resolve(process.env.VIDEO_DIR, `${reel.id}.mp4`);
  log(reelTag(reel.id), `render: ${path.basename(clip)} from ${start.toFixed(1)}s for ${audioLength.toFixed(1)}s, encoding to ${output}`);
  const filter = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,ass=${reel.subs_path}[v]`;
  await run('ffmpeg', [
    '-y', '-v', 'error',
    '-stream_loop', '-1', '-ss', start.toFixed(2), '-i', clip,
    '-i', reel.audio_path,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', audioLength.toFixed(2),
    '-movflags', '+faststart',
    output,
  ]);
  return { bg_video_path: clip, video_path: output };
}
