# k-data-mcp

MCP server for **Korean equity research and market data**, metered per call in USDC over [x402](https://x402.org). Start it without a wallet to inspect the catalog and run free, date-stamped previews; add a dedicated wallet only when you want paid calls.

## Try before funding a wallet

Run `npx k-data-mcp` with no environment variables to use these free tools:

- `list_endpoints` — paid catalog and prices.
- `preview_research_coverage` — real per-ticker report/brokerage counts and archive date ranges.
- `preview_research` — a single ticker's actual archive depth; this does not disclose report content.
- `preview_kimchi_premium` — live BTC-only dual-basis sample.

Set `K_DATA_PRIVATE_KEY` and `K_DATA_MAX_SPEND_USD` only when you are ready to enable paid tools.

## What you get

- **Kimchi premium on a tradeable basis.** Everyone quotes the premium against the official USD/KRW rate, but Korean capital controls mean the KRW exit leg actually goes through USDT — so that number is not something you can trade on. This returns both, and they routinely disagree *in sign*: official can read −0.27% while the realizable basis is +0.19%.
- **Premium history and percentile context.** A continuously recorded archive answers "is this premium unusual right now?" — percentile, mean, stdev, z-score over 1h–90d. No free source publishes this, and it cannot be reconstructed after the fact.
- **Korean headlines translated to English**, from Yonhap, Maeil Business and Hankyung. Korean myriad units (억 / 조) are expanded deterministically before translation, so "989억달러" comes back as *$98.9 billion* rather than the 10×-off answer language models produce unaided.
- **Korean sell-side research as structured data.** Target prices, ratings, brokerage and analyst per KRX ticker, each with an English summary, plus the consensus and revision history built from them — who raised, who cut, and how far apart the houses actually are. Only the facts of each report are sold, in our own words, with a link back to the publisher; the report PDF stays with the brokerage that wrote it. The listing source shows a rolling recent window only, so this series cannot be reconstructed after the fact either.
- Upbit KRW quotes and market summaries, USD/KRW.

## Install

```bash
npx k-data-mcp
```

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "k-data": {
      "command": "npx",
      "args": ["-y", "k-data-mcp"],
      "env": {
        "K_DATA_PRIVATE_KEY": "0xYOUR_DEDICATED_WALLET_KEY",
        "K_DATA_MAX_SPEND_USD": "1"
      }
    }
  }
}
```

## Wallet setup

Each tool call spends real USDC, so the server will not start without a key and a budget.

1. Create a **dedicated** wallet — not your main one. The key sits in a config file and every call spends from it.
2. Fund it with the USDC you're willing to spend on Base. **No ETH needed**: x402 settles with an off-chain EIP-3009 signature and the facilitator pays the gas.
3. Set `K_DATA_MAX_SPEND_USD`. The server refuses any call that would push cumulative spend past it.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `K_DATA_PRIVATE_KEY` | yes | — | Private key of the paying wallet (USDC on Base) |
| `K_DATA_MAX_SPEND_USD` | no | `1` | Hard cap on cumulative spend for the session |
| `K_DATA_BASE_URL` | no | hosted service | Point at a different K-Data deployment |

## Tools

`list_endpoints` is **free** — call it first to see current prices and decide what's worth buying.

| Tool | Price | Returns |
|---|---|---|
| `list_endpoints` | free | Catalog, current prices, wallet address, remaining budget |
| `kimchi_premium` | $0.03 | Dual-basis premium (official + USDT) for up to 10 coins |
| `kimchi_premium_stats` | $0.12 | Percentile, mean, stdev, z-score of the premium over 1h–90d |
| `kimchi_premium_history` | $0.08 | Premium time series, both bases |
| `korea_market_snapshot` | $0.08 | One-call briefing: premium + markets + FX + translated headlines |
| `research_consensus_ticker` | $0.12 | Analyst consensus for one KRX ticker — target price mean/median/range and spread, rating mix, and every house's revision history |
| `research_company_ticker` | $0.05 | Archived Korean brokerage reports for one ticker, summarised in English |
| `research_latest` | $0.02 | Latest Korean equity research across all covered companies |
| `news_headlines_en` | $0.05 | Korean headlines with English translations |
| `crypto_krw_markets` | $0.01 | All Upbit KRW markets — volume leaders, gainers, losers |
| `news_headlines` | $0.01 | Korean headlines, untranslated |
| `crypto_krw_ticker` | $0.005 | One Upbit KRW quote |
| `fx_usdkrw` | $0.005 | USD/KRW rate |

Prices are read from the provider's catalog at startup, so this table reflects whatever the service currently charges.

## How payment works

Every paid endpoint answers an unpaid request with `HTTP 402` and a `PAYMENT-REQUIRED` header describing the price, asset and recipient. This server signs an EIP-3009 authorization for that exact amount and retries; the facilitator settles it on Base. Nothing is held on account — you pay per call, and stop paying when you stop calling.

## License

MIT
