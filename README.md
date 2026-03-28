# stove-mcp

[Model Context Protocol](https://modelcontextprotocol.io) 服务器，封装 **Stove Protocol** 的 **Public API** 与 **Maker API**（与官方 DApp 的 [`stove-api-client`](https://github.com/StoveProtocol/stove-protocol-app/blob/main/src/lib/stove-api-client.ts) 路径一致）。任意支持 MCP 的 AI Agent（Cursor、Claude Desktop、自建客户端等）均可通过 stdio 调用。

- 官方概述：[Stove Protocol Developer Resources](https://docs.proto.stove.finance/developer/overview.html)
- 默认 HTTP 基址：`https://proto.stove.finance`

## 鉴权说明

| 类型 | 说明 |
|------|------|
| **Public** | 行情、订单簿、搜索等，**无需** JWT。 |
| **Maker** | 下单、仓位、公司行动等需要 **JWT**。JWT 来自用户在协议侧**钱包授权**（如 `stove_maker_connect` 对应 `POST /api/v1/makers/connect`），**不是**向平台申请的长期 API Key。 |

将 JWT 写入环境变量 **`STOVE_MAKER_JWT`**（由运行 MCP 的进程读取）。更新 JWT 后需重启 MCP 进程。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `STOVE_API_BASE_URL` | 否 | 默认 `https://proto.stove.finance` |
| `STOVE_MAKER_JWT` | Maker 工具需要 | 钱包授权后获得的 JWT |

## 安装与构建

需要 **Node.js ≥ 20**。

```bash
cd stove-mcp
npm install
npm run build
```

开发调试（不编译）：

```bash
npm run dev
```

## 在 Cursor 中使用

在 Cursor MCP 配置中增加（路径改为本机绝对路径）：

```json
{
  "mcpServers": {
    "stove-protocol": {
      "command": "node",
      "args": ["/绝对路径/stove-mcp/dist/index.js"],
      "env": {
        "STOVE_API_BASE_URL": "https://proto.stove.finance",
        "STOVE_MAKER_JWT": ""
      }
    }
  }
}
```

未构建时可将 `args` 改为：`["/绝对路径/stove-mcp/node_modules/.bin/tsx", "/绝对路径/stove-mcp/src/index.ts"]`（需已 `npm install`）。

## 在 Claude Desktop 中使用

编辑 Claude Desktop 的 MCP 配置文件（macOS 常见路径：`~/Library/Application Support/Claude/claude_desktop_config.json`），在 `mcpServers` 中加入与上文类似的 `stove-protocol` 条目。

## 提供的工具

- **`stove_integration_help`**：集成说明（建议先读）。
- **公开数据**：`stove_get_stats`、`stove_search_tickers`、`stove_get_orderbook`、`stove_get_orderbook_one_level`、`stove_get_ticker_stats`、`stove_get_heatmaps`、`stove_get_quote`、`stove_get_quotes_batch`、`stove_get_stock_info`、`stove_get_stock_financials`、`stove_get_klines`、`stove_get_trading_sessions`。
- **Maker**：`stove_maker_connect`、`stove_create_order`、`stove_cancel_order`、`stove_query_orders`、`stove_get_next_nonce`、`stove_get_next_filled_nonce`、`stove_estimate_order_charge`、`stove_get_positions`、`stove_get_token_address`，以及公司行动相关：`stove_get_corporate_action_status`、`stove_get_corporate_actions_pending`、`stove_approve_corporate_action`、`stove_process_corporate_action`。

成功响应体为 Stove 标准信封：`{ "code": 0, "data": ... }`，本服务器以 JSON 文本返回给 Agent。

## 推送到 GitHub

默认远程仓库：<https://github.com/susie-factory/stove-mcp>。

本仓库包含脚本 `scripts/push-to-github.mjs`（基于 [isomorphic-git](https://isomorphic-git.org/)），**不依赖系统安装的 `git`**，可在本地初始化、提交并推送。

1. 在 GitHub 创建 [Personal Access Token](https://github.com/settings/tokens)（需勾选仓库的 `contents` 写权限；对私有仓库使用 classic token 的 `repo` 或 fine-grained 的对应权限）。
2. 在项目根目录执行：

```bash
export GITHUB_TOKEN=ghp_你的令牌
node scripts/push-to-github.mjs
```

未设置 `GITHUB_TOKEN` 时，脚本会完成本地提交并提示如何推送。

若本机已安装 Git，也可使用常规命令：`git remote add origin …`、`git push -u origin main`（需自行配置凭据或 SSH）。

## 许可

MIT
