import type { Db } from '@receipts/db';

// The stage event log: every proof, review, payment and flag lands here, and the demo screen streams it.

export interface StageEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  created_at: string;
}

type Listener = (e: StageEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  constructor(private db: Db) {}

  async emit(type: string, data: Record<string, unknown> = {}): Promise<void> {
    try {
      const row = await this.db.one<StageEvent>('INSERT INTO events (type, data) VALUES ($1, $2) RETURNING id, type, data, created_at', [type, data]);
      for (const l of this.listeners) l({ ...row, id: Number(row.id) });
    } catch {
      // The log is best effort; never fail a review because the stage feed hiccuped.
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async recent(limit = 50, afterId = 0): Promise<StageEvent[]> {
    const rows = await this.db.query<StageEvent>('SELECT id, type, data, created_at FROM events WHERE id > $1 ORDER BY id DESC LIMIT $2', [afterId, limit]);
    return rows.map((r) => ({ ...r, id: Number(r.id) })).reverse();
  }
}
