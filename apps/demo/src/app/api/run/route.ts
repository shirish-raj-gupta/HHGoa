import { DEMO_QUESTION, runSideBySide } from '@receipts/agent';
import { agentSettings, stageAuthorized, unauthorized } from '@/lib/server';

// Runs both agents on one question and streams every step as server-sent events: "step" while they work, then
// one "result". The stage reads it with fetch, since EventSource cannot POST.

export const maxDuration = 120;

export async function POST(req: Request) {
  if (!stageAuthorized(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = (body.question?.trim() || DEMO_QUESTION).slice(0, 300);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send('start', { question });
      try {
        const result = await runSideBySide(question, { ...agentSettings(), onStep: (agent, step) => send('step', { agent, step }) });
        send('result', result);
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}
