import { newId } from '@receipts/core';
import type { Engine } from './context';

// Follow-up nudges wherever the reviewer is: native push (Expo), web push (PWA), WhatsApp templates for people who
// opted in, and email. Each is a one-tap yes/no plus an optional 5-second note. Every channel is optional.

export type PushKind = 'expo' | 'webpush' | 'whatsapp' | 'email';

export async function addPushTarget(e: Engine, reviewerId: string, kind: PushKind, target: Record<string, unknown>): Promise<string> {
  const id = newId('pt');
  await e.db.query('DELETE FROM push_targets WHERE reviewer_id = $1 AND kind = $2 AND target = $3::jsonb', [reviewerId, kind, JSON.stringify(target)]);
  await e.db.query('INSERT INTO push_targets (id, reviewer_id, kind, target) VALUES ($1, $2, $3, $4)', [id, reviewerId, kind, target]);
  return id;
}

function copy(kind: string, item: string, merchant: string): { title: string; body: string } {
  if (kind === '1d') return { title: 'Quick check-in', body: `Was the ${item} from ${merchant} still good the next day? One tap.` };
  if (kind === 'trip_end') return { title: 'How did the trip end?', body: `Anything change about ${merchant} by the end of your stay?` };
  if (kind === 'move_out') return { title: 'Moved out?', body: `How did moving out of ${merchant} go? Deposit back?` };
  if (/^\d+d$/.test(kind)) return { title: `Day ${kind.replace('d', '')} check-in`, body: `Is the ${item} still holding up?` };
  return { title: 'Check-in', body: `Still happy with ${item} from ${merchant}?` };
}

export async function sendFollowupNudge(e: Engine, reviewerId: string, f: { followupId: string; item: string; merchant: string; kind: string }): Promise<number> {
  const targets = await e.db.query<{ kind: PushKind; target: Record<string, string> }>('SELECT kind, target FROM push_targets WHERE reviewer_id = $1', [reviewerId]);
  const { title, body } = copy(f.kind, f.item, f.merchant);
  const url = `${e.urls.web}/followups?f=${f.followupId}`;
  let sent = 0;
  for (const t of targets) {
    try {
      if (t.kind === 'expo' && t.target.token) {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(e.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${e.env.EXPO_ACCESS_TOKEN}` } : {}) },
          body: JSON.stringify([{ to: t.target.token, title, body, data: { url, followupId: f.followupId }, categoryId: 'followup' }]),
        });
        if (res.ok) sent++;
      } else if (t.kind === 'webpush' && e.env.VAPID_PUBLIC_KEY && e.env.VAPID_PRIVATE_KEY) {
        const webpush = (await import('web-push')).default;
        webpush.setVapidDetails(`mailto:checkins@${new URL(e.urls.web).hostname}`, e.env.VAPID_PUBLIC_KEY, e.env.VAPID_PRIVATE_KEY);
        await webpush.sendNotification(t.target as never, JSON.stringify({ title, body, url, followupId: f.followupId }));
        sent++;
      } else if (t.kind === 'whatsapp' && e.env.WHATSAPP_TOKEN && e.env.WHATSAPP_PHONE_ID && t.target.phone) {
        const res = await fetch(`https://graph.facebook.com/v21.0/${e.env.WHATSAPP_PHONE_ID}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${e.env.WHATSAPP_TOKEN}` },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: t.target.phone,
            type: 'template',
            template: {
              name: e.env.WHATSAPP_TEMPLATE,
              language: { code: 'en' },
              components: [{ type: 'body', parameters: [{ type: 'text', text: f.item }, { type: 'text', text: f.merchant }] }],
            },
          }),
        });
        if (res.ok) sent++;
      } else if (t.kind === 'email' && e.env.RESEND_API_KEY && t.target.email) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${e.env.RESEND_API_KEY}` },
          body: JSON.stringify({ from: e.env.EMAIL_FROM, to: t.target.email, subject: title, html: `<p>${body}</p><p><a href="${url}">Answer in one tap</a></p>` }),
        });
        if (res.ok) sent++;
      }
    } catch (err) {
      e.log.warn(`push via ${t.kind} failed`, err);
    }
  }
  return sent;
}
