import fs from 'fs';

// arctic-shift archives reddit and needs no api key; requests rotate through browser user agents
const userAgents = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
];
let nextAgent = Math.floor(Math.random() * userAgents.length);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// newest posts first, only those older than `before` (unix seconds) when given; empty once the archive runs out
export async function fetchPage(subreddit, before) {
  const limit = Number(process.env.REDDIT_PAGE_SIZE);
  if (process.env.REDDIT_MOCK_FILE) {
    return JSON.parse(fs.readFileSync(process.env.REDDIT_MOCK_FILE, 'utf8'))
      .filter((p) => p.subreddit.toLowerCase() === subreddit.toLowerCase() && (!before || p.created_utc < before))
      .sort((a, b) => b.created_utc - a.created_utc)
      .slice(0, limit);
  }
  const params = new URLSearchParams({ subreddit, limit, sort: 'desc' });
  if (before) params.set('before', before);
  const res = await fetch(`${process.env.ARCTIC_SHIFT_URL}/api/posts/search?${params}`, {
    headers: { accept: 'application/json', 'user-agent': userAgents[nextAgent++ % userAgents.length] },
  });
  if (!res.ok) throw new Error(`arctic-shift r/${subreddit} ${res.status}: ${await res.text()}`);
  const { data } = await res.json();
  await pause(1000); // stay well under arctic-shift's rate limit when paging several subreddits
  return data;
}

// a stories row for a post worth narrating, or null for removed, nsfw, update, too short or too long posts
export function toStory(post) {
  const text = post.selftext?.trim() ?? '';
  if (!post.is_self || post.over_18 || post.stickied) return null;
  if (post.removed_by_category || post._meta?.removal_type || ['[removed]', '[deleted]'].includes(text)) return null;
  if (/update/i.test(post.title)) return null;
  if (text.length < Number(process.env.REDDIT_MIN_CHARS) || text.length > Number(process.env.REDDIT_MAX_CHARS)) return null;
  return {
    source: process.env.REDDIT_MOCK_FILE ? 'mock' : 'reddit',
    source_id: post.id,
    subreddit: post.subreddit,
    original_title: post.title,
    original_text: text,
    score: post.score,
    created_utc: post.created_utc,
  };
}
