import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPaymentWrapper, extractPaymentFromMeta } from '@x402/mcp';
import { CATEGORY_CONFIGS } from '@receipts/categories';
import type { PaidTool } from '@receipts/core';
import { z } from 'zod';
import type { Engine } from '../context';
import { UserError } from '../context';
import { accrueAnswer } from '../payouts';
import { coverage, itemReputation, merchantReputation, answerQuestion, type AskPayment } from '../query';
import { getReceipt, verifyReceipt } from '../reviews';
import { clickOut } from '../shopthrough';
import { payerOf, paymentRef, withinAgentCap, type X402 } from '../x402';

// Receipts as MCP tools. Three are paid over x402 (the requirements come back as a tool error until the agent
// pays; the signed payment rides in the next call's _meta); verification and coverage are always free, because
// anyone must be able to check a receipt.

type Accepts = Awaited<ReturnType<X402['server']['buildPaymentRequirements']>>;

export async function buildAccepts(x402: X402): Promise<Record<PaidTool, Accepts>> {
  const tools: PaidTool[] = ['search_receipts', 'get_item_reputation', 'get_merchant_reputation'];
  const out = {} as Record<PaidTool, Accepts>;
  for (const t of tools) {
    out[t] = await x402.server.buildPaymentRequirements({ scheme: 'exact', network: x402.network as never, payTo: x402.payTo, price: x402.price(t) });
  }
  return out;
}

function json(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof UserError ? err.message : err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

const INSTRUCTIONS = `Receipts answers "what should I buy or where should I go" with reviews from verified buyers in India: every review is backed by a cryptographic proof of purchase, written by a verified unique human, and anchored on Base.
Paid tools cost a fraction of a cent in USDC over x402 (search_receipts $0.005, reputation lookups $0.002). get_receipt, verify_receipt, get_shop_link and coverage are free.
Every claim in an answer links to the receipts that support it; cite them when you relay the answer. Buy links may earn Receipts a commission, which never affects rankings.`;

export function createReceiptsMcpServer(e: Engine, x402: X402 | null, accepts: Record<PaidTool, Accepts> | null): McpServer {
  const server = new McpServer({ name: 'receipts', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  const paidHandler = <A extends Record<string, unknown>>(tool: PaidTool, description: string, run: (args: A, payment: AskPayment) => Promise<unknown>) => {
    if (!x402 || !accepts) {
      return async (args: A) => {
        try {
          return json(await run(args, { method: 'free', amountBase: 0n, tool }));
        } catch (err) {
          return errorResult(err);
        }
      };
    }
    const paid = createPaymentWrapper(x402.server, {
      accepts: accepts[tool],
      resource: { url: `mcp://receipts/${tool}`, description, serviceName: 'Receipts', tags: ['reviews', 'verified-purchases', 'india'] },
      hooks: {
        onBeforeExecution: async ({ paymentPayload }) => withinAgentCap(e, payerOf(paymentPayload), x402.priceBase(tool)),
        onAfterSettlement: async ({ paymentPayload, settlement }) => {
          const rows = await e.db.query<{ id: string }>(`UPDATE answers SET payment_tx = $2 WHERE response->>'payment_ref' = $1 AND payment_tx IS NULL RETURNING id`, [
            paymentRef(paymentPayload),
            settlement.transaction,
          ]);
          for (const r of rows) {
            await accrueAnswer(e, r.id);
            await e.events.emit('payment.settled', { answerId: r.id, tx: settlement.transaction, network: settlement.network, via: 'mcp' });
          }
        },
      },
    });
    return paid(async (args: A, context) => {
      const payload = extractPaymentFromMeta({ _meta: context.meta } as never);
      try {
        return json(
          await run(args, {
            method: 'x402',
            amountBase: x402.priceBase(tool),
            network: x402.network,
            payer: payerOf(payload),
            paymentRef: payload ? paymentRef(payload) : null,
            tool,
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    });
  };

  server.registerTool(
    'search_receipts',
    {
      title: 'Search verified reviews',
      description:
        'Ranked options for a buying question ("best veg biryani under ₹400 near Calangute"), with trust score, verified-buyer count, durability, price actually paid, and claims that each link to their receipts. Costs $0.005 over x402.',
      inputSchema: {
        question: z.string().describe('The shopper question in plain words'),
        category: z.enum(CATEGORY_CONFIGS.map((c) => c.category) as [string, ...string[]]).optional(),
        place: z.string().optional().describe('Locality or city, e.g. Calangute'),
        lat: z.number().optional(),
        lng: z.number().optional(),
        radius_km: z.number().positive().max(100).optional(),
        max_results: z.number().int().min(1).max(5).optional(),
      },
    },
    paidHandler('search_receipts', 'Ranked answers from verified buyers', (args: Record<string, unknown>, payment) =>
      answerQuestion(
        e,
        {
          query: [String(args.question), args.place ? `near ${args.place}` : ''].filter(Boolean).join(' '),
          category: (args.category as string | undefined) ?? null,
          lat: (args.lat as number | undefined) ?? null,
          lng: (args.lng as number | undefined) ?? null,
          radiusKm: (args.radius_km as number | undefined) ?? null,
          limit: (args.max_results as number | undefined) ?? 3,
        },
        payment,
      ),
    ) as never,
  );

  server.registerTool(
    'get_item_reputation',
    {
      title: 'Item reputation',
      description: 'Score breakdown, rating histogram, top claims with receipts and durability for one item. Costs $0.002.',
      inputSchema: { item_id: z.string() },
    },
    paidHandler('get_item_reputation', 'Reputation of one item', async (args: Record<string, unknown>, payment) => {
      const result = await itemReputation(e, String(args.item_id));
      await logLookup(e, 'get_item_reputation', String(args.item_id), result, payment);
      return result;
    }) as never,
  );

  server.registerTool(
    'get_merchant_reputation',
    {
      title: 'Merchant reputation',
      description: 'Merchant-level score across items, reply rate and durability. Costs $0.002.',
      inputSchema: { merchant_id: z.string() },
    },
    paidHandler('get_merchant_reputation', 'Reputation of one merchant', async (args: Record<string, unknown>, payment) => {
      const result = await merchantReputation(e, String(args.merchant_id));
      await logLookup(e, 'get_merchant_reputation', String(args.merchant_id), result, payment);
      return result;
    }) as never,
  );

  server.registerTool(
    'get_receipt',
    { title: 'Get a receipt', description: 'One review: its JSON, a proof summary and the attestation link. Free.', inputSchema: { review_uid: z.string() } },
    async (args) => {
      try {
        return json(await getReceipt(e, String(args.review_uid)));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'verify_receipt',
    {
      title: 'Verify a receipt',
      description: 'Re-runs every check on a review (proof, wallet binding, nullifier, attestation, unique human) and reports pass or fail for each. Free.',
      inputSchema: { review_uid: z.string() },
    },
    async (args) => {
      try {
        return json(await verifyReceipt(e, String(args.review_uid)));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'get_shop_link',
    {
      title: 'Buy via Receipts',
      description: 'A shop-through link for an item, with the commission disclosed. Free. Rankings never read commission data.',
      inputSchema: { item_id: z.string() },
    },
    async (args) => {
      try {
        return json(await clickOut(e, String(args.item_id)));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    'coverage',
    { title: 'Coverage', description: 'Categories, brands and proof rails covered in an area or for a brand. Free.', inputSchema: { area: z.string().optional(), brand: z.string().optional() } },
    async (args) => {
      try {
        return json(await coverage(e, { area: args.area as string | undefined, brand: args.brand as string | undefined }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}

/** Reputation lookups are paid answers too: log them so the citations they draw on earn. */
async function logLookup(e: Engine, tool: string, subject: string, result: unknown, payment: AskPayment) {
  const { newId } = await import('@receipts/core');
  await e.db.query(
    `INSERT INTO answers (id, agent_wallet, tool, query, filters, response, price_usdc, payment_method, payment_network)
     VALUES ($1, $2, $3, $4, '{}', $5, $6, $7, $8)`,
    [newId('an'), payment.payer ?? null, tool, subject, { subject, payment_ref: payment.paymentRef ?? null }, payment.amountBase, payment.method, payment.network ?? null],
  );
  void result;
}
