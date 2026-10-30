import type { Engine } from './context';
import type { Logger } from './log';
import { followupTick } from './followups';
import { investigate } from './investigator';
import { refreshGooglePlaces } from './places';
import { anchorPending } from './reviews';
import { accrueTick, buildEpoch } from './payouts';
import { cashbackTick } from './shopthrough';
import { syncGraph } from './tigergraph';
import { runTrust } from './trust';

// Everything the worker runs, on a cron schedule. A table-backed design: every job reads its due work from
// Postgres, so restarts lose nothing.

export interface Job {
  name: string;
  /** cron expression (croner syntax), Asia/Kolkata */
  cron: string;
  run(e: Engine): Promise<unknown>;
}

async function investigateOpenFlags(e: Engine) {
  // Collusion signals get a case file; informational ones (copy-paste, tier B only) wait for a human.
  const flags = await e.db.query<{ id: string }>(
    `SELECT id FROM flags WHERE status = 'open' AND case_file IS NULL
        AND signal IN ('review_ring', 'shared_funder', 'seller_linked_payout', 'merchant_burst', 'cashback_farming')
      ORDER BY created_at LIMIT 3`,
  );
  for (const f of flags) await investigate(e, f.id).catch((err) => e.log.warn(`investigation of ${f.id} failed`, err));
  return flags.length;
}

async function audioCleanup(e: Engine) {
  // Voice identifies a person: the raw audio is deleted after 7 days; only text is ever published.
  const rows = await e.db.query(`UPDATE audio_objects SET ciphertext = NULL, deleted_at = now() WHERE delete_after < now() AND deleted_at IS NULL RETURNING id`);
  await e.db.query(`DELETE FROM auth_nonces WHERE created_at < now() - interval '1 day'`);
  return rows.length;
}

/** Logs a job's failure once rather than on every run: again only when the error changes, and once when the job
 *  works again. A paused TigerGraph workspace, say, would otherwise warn every five minutes. */
export function jobReporter(log: Logger) {
  const failing = new Map<string, string>();
  return {
    failed(name: string, err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (failing.get(name) === message) return;
      failing.set(name, message);
      log.warn(`${name} failed (said once, until it changes or recovers)`, err);
    },
    ok(name: string) {
      if (failing.delete(name)) log.info(`${name} recovered`);
    },
  };
}

export const JOBS: Job[] = [
  { name: 'accrue', cron: '* * * * *', run: accrueTick },
  { name: 'followups', cron: '* * * * *', run: followupTick },
  { name: 'trust', cron: '*/5 * * * *', run: (e) => runTrust(e, { onChainLevels: true }) },
  { name: 'graph-sync', cron: '*/5 * * * *', run: syncGraph },
  { name: 'investigate', cron: '*/2 * * * *', run: investigateOpenFlags },
  { name: 'cashback', cron: '*/10 * * * *', run: cashbackTick },
  { name: 'epoch', cron: '30 0 * * *', run: (e) => buildEpoch(e, { post: true }) },
  { name: 'audio-cleanup', cron: '0 * * * *', run: audioCleanup },
  { name: 'google-places', cron: '15 3 * * *', run: refreshGooglePlaces },
  { name: 'anchor-pending', cron: '*/2 * * * *', run: anchorPending },
];
