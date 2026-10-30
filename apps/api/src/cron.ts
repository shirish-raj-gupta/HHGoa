import { Cron } from 'croner';
import { JOBS, type Engine, type Job } from '@receipts/engine';

// For a host without a timer of its own (Vercel functions): a cron that calls every `minutes` runs each job whose own
// schedule fell inside that window, so every job runs about as often as it would in-process (or once a day, on a daily
// cron). The jobs read their due work from Postgres, so a late or doubled run loses nothing.

export function dueJobs(e: Engine, minutes: number, now = new Date()): Job[] {
  const since = new Date(now.getTime() - minutes * 60_000);
  return JOBS.filter((job) => {
    if (job.name === 'epoch' && !e.chain.canOperate) return false;
    const schedule = new Cron(job.cron, { timezone: 'Asia/Kolkata', paused: true });
    const next = schedule.nextRun(since);
    schedule.stop();
    return !!next && next <= now;
  });
}

export async function runDueJobs(e: Engine, minutes: number) {
  const ran: { job: string; ok: boolean; ms: number; error?: string }[] = [];
  for (const job of dueJobs(e, minutes)) {
    const t0 = Date.now();
    try {
      await job.run(e);
      ran.push({ job: job.name, ok: true, ms: Date.now() - t0 });
    } catch (err) {
      e.log.warn(`${job.name} failed`, err);
      ran.push({ job: job.name, ok: false, ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return ran;
}
