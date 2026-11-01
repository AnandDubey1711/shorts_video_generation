import fs from 'fs';
import { auth, youtube } from '@googleapis/youtube';
import { log, reelTag } from '../log.js';

const client = new auth.OAuth2(process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET, process.env.YT_REDIRECT_URI);

if (fs.existsSync(process.env.YT_TOKEN_PATH)) {
  client.setCredentials(JSON.parse(fs.readFileSync(process.env.YT_TOKEN_PATH, 'utf8')));
}

export function authUrl() {
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
  });
}

export async function saveToken(code) {
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(process.env.YT_TOKEN_PATH, JSON.stringify(tokens));
}

export async function upload(reel) {
  if (!client.credentials.refresh_token && !client.credentials.access_token) {
    throw new Error('youtube not connected - open /auth/youtube in a browser first');
  }
  log(reelTag(reel.id), `upload: sending ${reel.video_path} to YouTube as ${process.env.YT_PRIVACY}`);
  const res = await youtube({ version: 'v3', auth: client }).videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: reel.title,
        description: `${reel.description}\n\n${reel.hashtags.join(' ')}`,
        tags: reel.hashtags.map((h) => h.slice(1)),
        categoryId: '24',
      },
      status: {
        privacyStatus: process.env.YT_PRIVACY,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: Boolean(process.env.SYNTHETIC),
      },
    },
    media: { body: fs.createReadStream(reel.video_path) },
  });
  return { youtube_id: res.data.id };
}
