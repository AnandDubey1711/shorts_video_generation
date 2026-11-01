import fs from 'fs';
import path from 'path';
import { log, reelTag } from '../log.js';

const system = fs.readFileSync(path.join(import.meta.dirname, '../prompts/system.txt'), 'utf8');

const schema = {
  type: 'object',
  properties: {
    story: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    narrator_gender: { type: 'string', enum: ['female', 'male'] },
  },
  required: ['story', 'title', 'description', 'hashtags', 'narrator_gender'],
};

async function chat(messages, tag) {
  log(tag, `script: asking ${process.env.OLLAMA_MODEL} (first output waits for the model to load)`);
  const res = await fetch(`${process.env.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL,
      stream: true,
      think: false,
      keep_alive: 0,
      format: schema,
      options: { temperature: 0.7, num_ctx: 8192, reasoning: 0 },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let nextProgress = 0;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line) content += JSON.parse(line).message.content;
    if (content.length >= nextProgress) {
      log(tag, nextProgress ? `script: ${content.length} chars written so far` : 'script: model loaded, writing');
      nextProgress += 500;
    }
  }
  log(tag, `script: finished, ${content.length} chars`);
  return JSON.parse(content);
}

export async function writeScript(reel) {
  const tag = reelTag(reel.id);
  const out = await chat(
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Rewrite this Reddit post as a 300 word narration script.\n\nTitle: ${reel.original_title}\n\n${reel.original_text}`,
      },
    ],
    tag,
  );
  const words = out.story.split(/\s+/).length;
  log(tag, `script: ${words} words (allowed ${process.env.MIN_WORDS}-${process.env.MAX_WORDS}), ${out.narrator_gender} narrator, title "${out.title}"`);
  if (words < Number(process.env.MIN_WORDS)) throw new Error(`story too short: ${words} words`);
  if (words > Number(process.env.MAX_WORDS)) throw new Error(`story too long: ${words} words`);
  return {
    title: out.title.replace(/[<>]/g, '').slice(0, 100),
    story: out.story.replace(/\bAITAH?\b/g, 'am I the jerk').replace(/\bWIBTA\b/g, 'would I be the jerk'),
    description: out.description.replace(/[<>]/g, ''),
    hashtags: out.hashtags.map((h) => `#${h.replace(/[^a-z0-9_]/gi, '').toLowerCase()}`).filter((h) => h.length > 1),
    narrator_gender: out.narrator_gender,
  };
}
