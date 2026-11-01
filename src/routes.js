import { Router } from 'express';
import db from './db.js';
import { queue } from './queue.js';
import * as youtube from './services/youtube.js';

const router = Router();

router.get('/health', (req, res) => res.json({ ok: true }));

router.get('/reels', async (req, res) => {
  const query = db('reels').orderBy('created_at', 'desc').limit(100);
  if (req.query.status) query.where('status', req.query.status);
  res.json(await query);
});

router.get('/reels/:id', async (req, res) => {
  const reel = await db('reels').where({ id: req.params.id }).first();
  if (!reel) return res.status(404).json({ error: 'not found' });
  res.json(reel);
});

router.post('/reels/fetch', async (req, res) => {
  const job = await queue.add('fetch', {});
  res.json({ queued: job.id });
});

router.post("/reels/fetch/custom_job", async(req,res)=>{
    const {title, story} = req.body;
    if(!title || !story){
      res.status(400).json({"data":"title or story is missing"});
    }
    const job = await queue.add('fetch', {title, story});
    res.json({ queued: job.id });
});

router.post('/reels/:id/retry', async (req, res) => {
  const updated = await db('reels').where({ id: req.params.id }).update({ status: 'pending' });
  if (!updated) return res.status(404).json({ error: 'not found' });
  const job = await queue.add('produce', { id: req.params.id });
  res.json({ queued: job.id });
});

router.get('/auth/youtube', (req, res) => res.redirect(youtube.authUrl()));

router.get('/auth/youtube/callback', async (req, res) => {
  await youtube.saveToken(req.query.code);
  res.send('YouTube connected');
});

export default router;
