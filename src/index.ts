#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import {
  formatEnvelope,
  getMakerJwtFromEnv,
  getStoveBaseUrl,
  stoveRequest,
  type StoveEnvelope,
} from './stove-http.js';

const SERVER_NAME = 'stove-protocol';
const SERVER_VERSION = '1.0.0';

function textResponse(body: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: body }] };
}

async function callStove<T>(
  label: string,
  fn: () => Promise<{ ok: true; envelope: StoveEnvelope<T> } | { ok: false; error: string }>,
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const r = await fn();
  if (!r.ok) return textResponse(`${label} failed: ${r.error}`);
  return textResponse(formatEnvelope(r.envelope));
}

function requireMakerJwt(): string | { content: [{ type: 'text'; text: string }] } {
  const jwt = getMakerJwtFromEnv();
  if (!jwt) {
    return textResponse(
      'Maker 工具需要环境变量 STOVE_MAKER_JWT（钱包在协议中授权后获得的 JWT）。' +
        '可先使用 stove_maker_connect 换 JWT，再写入环境变量并重启 MCP。',
    );
  }
  return jwt;
}

const marketSchema = z.enum(['usex', 'hkex', 'dcex']).describe('市场：usex / hkex / dcex');

const corporateActionTypeSchema = z.enum([
  'stock_split',
  'reverse_stock_split',
  'delisting',
  'dividend',
]);

const server = new McpServer(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION,
  },
  {
    instructions: [
      'Stove Protocol MCP：Public 接口无需鉴权；Maker 接口需要环境变量 STOVE_MAKER_JWT（钱包在协议中授权后获得的 JWT，非传统 API Key）。',
      '默认 API 基址为 https://proto.stove.finance，可用 STOVE_API_BASE_URL 覆盖。',
      '可先调用 stove_integration_help，再使用 stove_maker_connect 换取 JWT 并写入环境变量。',
    ].join('\n'),
  },
);

// --- Integration guide (no HTTP) ---
server.registerTool(
  'stove_integration_help',
  {
    title: 'Stove MCP 集成说明',
    description:
      '说明 Stove Protocol MCP 的鉴权方式（Public 无需 JWT；Maker 使用钱包授权后的 JWT）、环境变量与官方文档链接。调用其他工具前可先阅读。',
    inputSchema: z.object({}),
  },
  async () =>
    textResponse(
      [
        '## Stove Protocol MCP',
        '',
        '- **基址**：默认 `https://proto.stove.finance`，可用 `STOVE_API_BASE_URL` 覆盖。',
        '- **Public API**：行情、订单簿、搜索等，**无需** JWT。',
        '- **Maker API**：下单、仓位、公司行动等需要 **JWT**。JWT 来自用户在链上/钱包对协议的授权（`POST /api/v1/makers/connect`），**不是**申请的传统 API Key。',
        '- **环境变量**：`STOVE_MAKER_JWT` — 将钱包授权后拿到的 JWT 配置给 MCP 进程（各 Agent 客户端均在 MCP server 的 env 中设置）。',
        '- **官方文档**：[Developer Resources](https://docs.proto.stove.finance/developer/overview.html)',
        '',
        '本服务器工具与官方 DApp 的 `stove-api-client` 路径保持一致。',
      ].join('\n'),
    ),
);

// --- Public: stats & search ---
server.registerTool(
  'stove_get_stats',
  {
    title: '平台统计',
    description: 'GET /api/v1/stats — 协议级统计（用户数、订单数、标的数等）。',
    inputSchema: z.object({}),
  },
  async () => callStove('stove_get_stats', () => stoveRequest('/api/v1/stats')),
);

server.registerTool(
  'stove_search_tickers',
  {
    title: '搜索标的',
    description: 'GET /api/v1/tickers/search — 按关键词搜索股票/标的列表。',
    inputSchema: z.object({
      keyword: z.string().min(1).describe('搜索关键词'),
      size: z.number().int().positive().max(100).optional().describe('返回条数，默认 20'),
    }),
  },
  async ({ keyword, size }) =>
    callStove('stove_search_tickers', () =>
      stoveRequest('/api/v1/tickers/search', {
        query: { keyword, size: size ?? 20 },
      }),
    ),
);

// --- Public: orderbooks & tickers (api/v1) ---
server.registerTool(
  'stove_get_orderbook',
  {
    title: '订单簿（多档）',
    description: 'GET /api/v1/tickers/{symbol}/orderbooks — 查询订单簿。',
    inputSchema: z.object({
      symbol: z.string().min(1).describe('标的代码，如 AAPL'),
      exchange: z.number().int().min(0).describe('交易所代码，默认 0（美股 USEX）'),
    }),
  },
  async ({ symbol, exchange }) =>
    callStove('stove_get_orderbook', () =>
      stoveRequest(`/api/v1/tickers/${encodeURIComponent(symbol)}/orderbooks`, {
        query: { exchange },
      }),
    ),
);

server.registerTool(
  'stove_get_orderbook_one_level',
  {
    title: '订单簿（单层）',
    description: 'GET /market/v1/tickers/{symbol}/orderbooks — 单层订单簿（market 参数）。',
    inputSchema: z.object({
      symbol: z.string().min(1).describe('标的代码'),
      market: marketSchema.optional().describe('默认 usex'),
    }),
  },
  async ({ symbol, market }) =>
    callStove('stove_get_orderbook_one_level', () =>
      stoveRequest(`/market/v1/tickers/${encodeURIComponent(symbol)}/orderbooks`, {
        query: { market: market ?? 'usex' },
      }),
    ),
);

server.registerTool(
  'stove_get_ticker_stats',
  {
    title: '标的统计',
    description: 'GET /api/v1/tickers/{symbol}/stats — 单标的订单量、成交量等统计。',
    inputSchema: z.object({
      symbol: z.string().min(1).describe('标的代码'),
      exchange: z.number().int().describe('交易所代码'),
    }),
  },
  async ({ symbol, exchange }) =>
    callStove('stove_get_ticker_stats', () =>
      stoveRequest(`/api/v1/tickers/${encodeURIComponent(symbol)}/stats`, {
        query: { exchange },
      }),
    ),
);

server.registerTool(
  'stove_get_heatmaps',
  {
    title: '热力图',
    description: 'GET /api/v1/tickers/heatmaps — 热力图数据。',
    inputSchema: z.object({
      exchange: z.number().int().describe('交易所代码'),
    }),
  },
  async ({ exchange }) =>
    callStove('stove_get_heatmaps', () =>
      stoveRequest('/api/v1/tickers/heatmaps', { query: { exchange } }),
    ),
);

// --- Public: market/v1 quotes & info ---
server.registerTool(
  'stove_get_quote',
  {
    title: '单标的行情',
    description: 'GET /market/v1/tickers/{symbol}/quote — 实时报价。',
    inputSchema: z.object({ symbol: z.string().min(1).describe('标的代码') }),
  },
  async ({ symbol }) =>
    callStove('stove_get_quote', () =>
      stoveRequest(`/market/v1/tickers/${encodeURIComponent(symbol)}/quote`),
    ),
);

server.registerTool(
  'stove_get_quotes_batch',
  {
    title: '批量行情',
    description: 'GET /market/v1/tickers/quotes — 批量查询报价。',
    inputSchema: z.object({
      symbols: z.string().min(1).describe('逗号分隔或多个代码，格式以 API 为准'),
      market: marketSchema.optional().describe('默认 usex'),
    }),
  },
  async ({ symbols, market }) =>
    callStove('stove_get_quotes_batch', () =>
      stoveRequest('/market/v1/tickers/quotes', {
        query: { symbols, market: market ?? 'usex' },
      }),
    ),
);

server.registerTool(
  'stove_get_stock_info',
  {
    title: '标的基本信息',
    description: 'GET /market/v1/tickers/{symbol}/info — 公司信息、行业等。',
    inputSchema: z.object({
      symbol: z.string().min(1).describe('标的代码'),
      market: marketSchema.optional().describe('默认 usex'),
    }),
  },
  async ({ symbol, market }) =>
    callStove('stove_get_stock_info', () =>
      stoveRequest(`/market/v1/tickers/${encodeURIComponent(symbol)}/info`, {
        query: { market: market ?? 'usex' },
      }),
    ),
);

server.registerTool(
  'stove_get_stock_financials',
  {
    title: '财务指标',
    description: 'GET /market/v1/tickers/{symbol}/financials — 财务与估值指标。',
    inputSchema: z.object({
      symbol: z.string().min(1).describe('标的代码'),
      market: marketSchema.optional().describe('默认 usex'),
    }),
  },
  async ({ symbol, market }) =>
    callStove('stove_get_stock_financials', () =>
      stoveRequest(`/market/v1/tickers/${encodeURIComponent(symbol)}/financials`, {
        query: { market: market ?? 'usex' },
      }),
    ),
);

server.registerTool(
  'stove_get_klines',
  {
    title: 'K 线',
    description: 'GET /market/v1/tickers/{symbol}/klines — K 线/蜡烛数据。',
    inputSchema: z.object({
      symbol: z.string().min(1).describe('标的代码'),
      market: marketSchema.optional().describe('默认 usex'),
      start_time: z.union([z.string(), z.number()]).describe('开始时间（与 API 约定一致）'),
      end_time: z.union([z.string(), z.number()]).describe('结束时间'),
      interval: z.string().describe('周期，如 1d'),
      limit: z.number().int().positive().max(5000).optional().describe('条数上限，默认 1000'),
    }),
  },
  async ({ symbol, market, start_time, end_time, interval, limit }) =>
    callStove('stove_get_klines', () =>
      stoveRequest(`/market/v1/tickers/${encodeURIComponent(symbol)}/klines`, {
        query: {
          market: market ?? 'usex',
          start_time,
          end_time,
          interval,
          limit: limit ?? 1000,
        },
      }),
    ),
);

server.registerTool(
  'stove_get_trading_sessions',
  {
    title: '交易时段',
    description: 'GET /market/v1/{market}/trading-sessions — 当前市场交易时段状态。',
    inputSchema: z.object({
      market: marketSchema.optional().describe('默认 usex'),
    }),
  },
  async ({ market }) =>
    callStove('stove_get_trading_sessions', () =>
      stoveRequest(`/market/v1/${market ?? 'usex'}/trading-sessions`),
    ),
);

// --- Maker: connect (no JWT) ---
server.registerTool(
  'stove_maker_connect',
  {
    title: 'Maker 连接 / 换 JWT',
    description:
      'POST /api/v1/makers/connect — 提交钱包签名后换取 JWT。无需已有 STOVE_MAKER_JWT。返回的 jwt 可写入环境变量 STOVE_MAKER_JWT。',
    inputSchema: z.object({
      wallet_address: z.string().min(1).describe('钱包地址'),
      chain_id: z.string().describe('链 ID 字符串'),
      message: z.string().min(1).describe('待签名消息'),
      signature: z.string().min(1).describe('签名 hex'),
    }),
  },
  async (body) =>
    callStove('stove_maker_connect', () =>
      stoveRequest('/api/v1/makers/connect', { method: 'POST', body }),
    ),
);

// --- Maker: orders & positions (JWT) ---
const orderPrincipalSchema = z.object({
  principal: z.string(),
  isBuy: z.boolean(),
  ticker: z.string(),
  exchange: z.number().int(),
  asset: z.string(),
  price: z.string(),
  quantity: z.string(),
  incentive: z.string(),
  deadline: z.number().int(),
  nonce: z.number().int(),
});

server.registerTool(
  'stove_create_order',
  {
    title: '创建订单',
    description: 'POST /api/v1/orders — 创建 RFQ/订单（需 STOVE_MAKER_JWT）。',
    inputSchema: z.object({
      order: orderPrincipalSchema,
      signature: z.string().min(1).describe('订单 EIP-712 或协议要求的签名'),
    }),
  },
  async (data) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_create_order', () =>
      stoveRequest('/api/v1/orders', { method: 'POST', body: data, jwt }),
    );
  },
);

server.registerTool(
  'stove_cancel_order',
  {
    title: '撤销订单',
    description: 'POST /api/v1/orders/{order_id}/cancel — 撤销指定订单。',
    inputSchema: z.object({
      order_id: z.string().min(1).describe('订单 ID'),
    }),
  },
  async ({ order_id }) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_cancel_order', () =>
      stoveRequest(`/api/v1/orders/${encodeURIComponent(order_id)}/cancel`, {
        method: 'POST',
        jwt,
      }),
    );
  },
);

const queryOrdersParamsSchema = z
  .object({
    order_hash: z.string().optional(),
    principal: z.string().optional(),
    ticker: z.string().optional(),
    ticker_like: z.boolean().optional(),
    exchange: z.number().int().optional(),
    asset: z.string().optional(),
    is_buy: z.boolean().optional(),
    nonce: z.number().int().optional(),
    price_min: z.string().optional(),
    price_max: z.string().optional(),
    quantity_min: z.string().optional(),
    quantity_max: z.string().optional(),
    incentive_min: z.string().optional(),
    incentive_max: z.string().optional(),
    filled_quantity_min: z.string().optional(),
    filled_quantity_max: z.string().optional(),
    status: z.string().optional(),
    deadline_after: z.number().optional(),
    deadline_before: z.number().optional(),
    created_after: z.number().optional(),
    created_before: z.number().optional(),
    sort_by: z.string().optional(),
    sort_order: z.string().optional(),
    page: z.number().int().optional(),
    page_size: z.number().int().optional(),
  })
  .strict();

server.registerTool(
  'stove_query_orders',
  {
    title: '查询订单列表',
    description: 'GET /api/v1/orders — 分页与筛选查询订单。',
    inputSchema: queryOrdersParamsSchema.describe('查询参数，均可选'),
  },
  async (params) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) clean[k] = v as string | number | boolean;
    }
    return callStove('stove_query_orders', () =>
      stoveRequest('/api/v1/orders', { query: clean, jwt }),
    );
  },
);

server.registerTool(
  'stove_get_next_nonce',
  {
    title: '下一个订单 nonce',
    description: 'GET /api/v1/orders/maker/next-nonce — 获取 maker 下一 nonce。',
    inputSchema: z.object({}),
  },
  async () => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_get_next_nonce', () =>
      stoveRequest('/api/v1/orders/maker/next-nonce', { jwt }),
    );
  },
);

server.registerTool(
  'stove_get_next_filled_nonce',
  {
    title: '下一个已成交 nonce',
    description: 'GET /api/v1/orders/maker/next-filled-nonce',
    inputSchema: z.object({}),
  },
  async () => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_get_next_filled_nonce', () =>
      stoveRequest('/api/v1/orders/maker/next-filled-nonce', { jwt }),
    );
  },
);

server.registerTool(
  'stove_estimate_order_charge',
  {
    title: '预估费用',
    description: 'POST /api/v1/orders/estimate_charge — 预估下单费用。',
    inputSchema: z.object({
      is_buy: z.boolean(),
      ticker: z.string(),
      exchange: z.number().int(),
      quantity: z.string(),
      price: z.string(),
      asset: z.string(),
      target_currency: z.string().optional(),
    }),
  },
  async (body) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_estimate_order_charge', () =>
      stoveRequest('/api/v1/orders/estimate_charge', { method: 'POST', body, jwt }),
    );
  },
);

server.registerTool(
  'stove_get_positions',
  {
    title: '查询持仓',
    description: 'GET /api/v1/positions — Maker 持仓分页查询。',
    inputSchema: z.object({
      page: z.number().int().positive().optional().describe('页码，默认 1'),
      page_size: z.number().int().positive().max(200).optional().describe('每页条数，默认 20'),
      ticker: z.string().optional().describe('按代码筛选'),
      ticker_like: z.boolean().optional().describe('是否模糊匹配 ticker，默认 true'),
    }),
  },
  async ({ page, page_size, ticker, ticker_like }) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_get_positions', () =>
      stoveRequest('/api/v1/positions', {
        query: {
          page: page ?? 1,
          page_size: page_size ?? 20,
          ticker: ticker ?? '',
          ticker_like: ticker_like ?? true,
        },
        jwt,
      }),
    );
  },
);

server.registerTool(
  'stove_get_token_address',
  {
    title: '标的代币合约地址',
    description: 'GET /api/v1/instruments/token-address — 查询证券代币合约地址。',
    inputSchema: z.object({
      exchange: z.number().int().describe('交易所代码'),
      ticker: z.string().min(1).describe('标的代码'),
    }),
  },
  async ({ exchange, ticker }) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_get_token_address', () =>
      stoveRequest('/api/v1/instruments/token-address', {
        query: { exchange, ticker },
        jwt,
      }),
    );
  },
);

// --- Maker: corporate actions ---
server.registerTool(
  'stove_get_corporate_action_status',
  {
    title: '公司行动处理状态',
    description: 'GET /api/v1/maker/corporate-actions/token/{token}/processing-status',
    inputSchema: z.object({
      token: z.string().min(1).describe('资产/持仓 token 标识'),
    }),
  },
  async ({ token }) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_get_corporate_action_status', () =>
      stoveRequest(
        `/api/v1/maker/corporate-actions/token/${encodeURIComponent(token)}/processing-status`,
        { jwt },
      ),
    );
  },
);

server.registerTool(
  'stove_get_corporate_actions_pending',
  {
    title: '待处理公司行动',
    description: 'GET /api/v1/maker/corporate-actions/pending',
    inputSchema: z.object({
      token: z.string().min(1).describe('token 参数'),
    }),
  },
  async ({ token }) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_get_corporate_actions_pending', () =>
      stoveRequest('/api/v1/maker/corporate-actions/pending', {
        query: { token },
        jwt,
      }),
    );
  },
);

server.registerTool(
  'stove_approve_corporate_action',
  {
    title: '批准公司行动',
    description: 'POST /api/v1/corporate-actions/approve',
    inputSchema: z.object({
      action_id: z.string(),
      ticker: z.string(),
      type: corporateActionTypeSchema,
    }),
  },
  async (body) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_approve_corporate_action', () =>
      stoveRequest('/api/v1/corporate-actions/approve', { method: 'POST', body, jwt }),
    );
  },
);

server.registerTool(
  'stove_process_corporate_action',
  {
    title: '处理公司行动',
    description: 'POST /api/v1/maker/corporate-actions/action/{action_id}/process?asset_token=',
    inputSchema: z.object({
      action_id: z.string().min(1),
      asset_token: z.string().min(1).describe('资产 token，query 参数'),
    }),
  },
  async ({ action_id, asset_token }) => {
    const jwt = requireMakerJwt();
    if (typeof jwt !== 'string') return jwt;
    return callStove('stove_process_corporate_action', () =>
      stoveRequest(
        `/api/v1/maker/corporate-actions/action/${encodeURIComponent(action_id)}/process`,
        { method: 'POST', query: { asset_token }, jwt },
      ),
    );
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} MCP v${SERVER_VERSION} on stdio (base: ${getStoveBaseUrl()})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
