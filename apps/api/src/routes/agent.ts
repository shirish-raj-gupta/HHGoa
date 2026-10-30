import { Hono, type MiddlewareHandler } from 'hono';
import { paymentMiddleware } from '@x402/hono';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { PRICES_USDC, usdcToBase, type PaidTool } from '@receipts/core';
import {
  UserError,
  billing,
  buildAccepts,
  createReceiptsMcpServer,
  payerOf,
  paymentRef,
  query,
  withinAgentCap,
  type AskPayment,
  type Engine,
  type X402,
} from '@receipts/engine';
import { ok, type Env } from '../http';

// Agents pay per answer: x402 (USDC on Base) by default, or prepaid card credits with an API key. Verification and
// coverage are free. The same tools are exposed over MCP at /mcp.

export async function agentRoutes(e: Engine, x402: X402 | null) {
  const app = new Hono<Env>();
  const accepts = x402 ? await buildAccepts(x402).catch((err) => {
    e.log.warn('x402: could not build payment requirements (facilitator unreachable?)', err);
    return null;
  }) : null;

  const x402Middleware = x402
    ? paymentMiddleware(
        {
          'GET /v1/answer': { accepts: [{ scheme: 'exact', price: x402.price('search_receipts'), network: x402.network as never, payTo: x402.payTo }], description: 'Ranked answers from verified buyers, every claim linked to its receipts' },
          'GET /v1/items/*/reputation': { accepts: [{ scheme: 'exact', price: x402.price('get_item_reputation'), network: x402.network as never, payTo: x402.payTo }], description: 'Item reputation' },
          'GET /v1/merchants/*/reputation': {
            accepts: [{ scheme: 'exact', price: x402.price('get_merchant_reputation'), network: x402.network as never, payTo: x402.payTo }],
            description: 'Merchant reputation',
          },
        },
        x402.server,
        undefined,
        undefined,
        false,
      )
    : null;

  /** Credits (API key) skip x402; otherwise x402 decides. Either way the handler learns how it was paid. */
  const paid = (tool: PaidTool): MiddlewareHandler<Env> => async (c, next) => {
    const key = await billing.apiKeyFromHeader(e, c.req.header('authorization'));
    const price = x402?.priceBase(tool) ?? 0n;
    if (key) {
      if (key.disabled) throw new UserError('API key disabled.', 403);
      const amount = price || usdcToBase(PRICES_USDC[tool]);
      await billing.chargeCredits(e, key.id, amount, tool);
      c.set('payment', { method: 'credits', amountBase: amount, apiKeyId: key.id, tool });
      return next();
    }
    if (!x402Middleware || !x402) {
      c.set('payment', { method: 'free', amountBase: 0n, tool });
      return next();
    }
    const header = c.req.header('payment-signature') ?? c.req.header('x-payment');
    if (header) {
      const payload = decodePaymentSignatureHeader(header);
      const payer = payerOf(payload);
      if (!(await withinAgentCap(e, payer, price))) throw new UserError('This agent hit its daily spend cap.', 429, 'agent_cap');
      c.set('payment', { method: 'x402', amountBase: price, network: x402.network, payer, paymentRef: paymentRef(payload), tool });
    }
    return x402Middleware(c, next);
  };

  app.get('/v1/answer', paid('search_receipts'), async (c) => {
    const q = c.req.query('q');
    if (!q) throw new UserError('Pass the question as ?q=', 400);
    const num = (k: string) => (c.req.query(k) ? Number(c.req.query(k)) : null);
    const payment = c.get('payment') as AskPayment;
    return ok(c, await query.answerQuestion(e, { query: q, category: c.req.query('category') ?? null, lat: num('lat'), lng: num('lng'), radiusKm: num('radius_km') }, payment));
  });

  app.get('/v1/items/:id/reputation', paid('get_item_reputation'), async (c) => ok(c, await query.itemReputation(e, c.req.param('id'))));
  app.get('/v1/merchants/:id/reputation', paid('get_merchant_reputation'), async (c) => ok(c, await query.merchantReputation(e, c.req.param('id'))));

  // MCP over streamable HTTP, stateless: one server per request, JSON responses.
  app.all('/mcp', async (c) => {
    const server = createReceiptsMcpServer(e, accepts ? x402 : null, accepts);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
