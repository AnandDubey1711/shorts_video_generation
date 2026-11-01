import { Queue } from 'bullmq';

export const connection = { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT) };

export const queue = new Queue('reels', {
  connection,
  defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
});
