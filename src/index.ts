#!/usr/bin/env node
/**
 * MCP server for K-Data — Korean market data, metered per call with x402.
 *
 * The tool list is not hard-coded. On start the server reads the provider's
 * free `/api/catalog` and generates one tool per paid endpoint, so endpoints
 * added upstream appear here without republishing this package.
 *
 * Calls are paid from a wallet the operator supplies. Because that spends real
 * funds on the operator's behalf, the server refuses to start without an
 * explicit budget and stops once the budget is exhausted.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const BASE_URL = (process.env.K_DATA_BASE_URL ?? "https://k-data-x402-production.theblack1022.workers.dev").replace(/\/$/, "");
const PRIVATE_KEY = process.env.K_DATA_PRIVATE_KEY as `0x${string}` | undefined;
const BUDGET_USD = Number(process.env.K_DATA_MAX_SPEND_USD ?? "1");

interface CatalogEndpoint {
  method: string;
  path: string;
  price_usd: string;
  description: string;
  query_params: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }> } | null;
  path_params: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] } | null;
  output_example: unknown;
}

interface Catalog {
  service: string;
  tagline: string;
  why_this_service?: string[];
  payment: { network: string; currency: string };
  paid_endpoints: CatalogEndpoint[];
}

/** `/api/kimchi-premium/stats` -> `kimchi_premium_stats` */
function toolNameFor(path: string): string {
  return path
    .replace(/^\/api\//, "")
    .replace(/:/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function priceToNumber(price: string): number {
  return Number(price.replace(/[^0-9.]/g, "")) || 0;
}

async function main() {
  if (!PRIVATE_KEY) {
    console.error(
      [
        "K_DATA_PRIVATE_KEY is required.",
        "",
        "It must be the private key of a wallet holding USDC on Base. Every tool",
        "call spends from it, so use a dedicated wallet funded with only what you",
        "intend to spend — never your main wallet.",
        "",
        "No gas token is needed: x402 settles with an off-chain EIP-3009",
        "signature and the facilitator pays the gas.",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (!Number.isFinite(BUDGET_USD) || BUDGET_USD <= 0) {
    console.error("K_DATA_MAX_SPEND_USD must be a positive number of US dollars.");
    process.exit(1);
  }

  const catalogRes = await fetch(`${BASE_URL}/api/catalog`);
  if (!catalogRes.ok) {
    console.error(`Could not read catalog from ${BASE_URL}/api/catalog (HTTP ${catalogRes.status}).`);
    process.exit(1);
  }
  const catalog = (await catalogRes.json()) as Catalog;

  const account = privateKeyToAccount(PRIVATE_KEY);
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(account));
  const payingFetch = wrapFetchWithPayment(fetch, client);

  let spent = 0;

  const server = new McpServer({ name: "k-data", version: "0.1.0" });

  // Free: lets an agent see prices and decide before spending anything.
  server.tool(
    "list_endpoints",
    "List every available K-Data endpoint with its price in USD and what it returns. Free — costs nothing to call. Use this before spending to decide which paid tool is worth calling.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              service: catalog.service,
              why_this_service: catalog.why_this_service,
              wallet: account.address,
              budget_usd: BUDGET_USD,
              spent_usd: +spent.toFixed(4),
              endpoints: catalog.paid_endpoints.map(e => ({
                tool: toolNameFor(e.path),
                price_usd: e.price_usd,
                description: e.description,
              })),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  for (const endpoint of catalog.paid_endpoints) {
    const name = toolNameFor(endpoint.path);
    const price = priceToNumber(endpoint.price_usd);

    // Build the argument schema from the catalog's declared params.
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [param, spec] of Object.entries(endpoint.path_params?.properties ?? {})) {
      shape[param] = z.string().describe(spec.description ?? `Path parameter ${param}`);
    }
    for (const [param, spec] of Object.entries(endpoint.query_params?.properties ?? {})) {
      const described = spec.description ?? `Query parameter ${param}`;
      shape[param] =
        spec.type === "integer" || spec.type === "number"
          ? z.number().optional().describe(described)
          : spec.enum
            ? z.enum(spec.enum as [string, ...string[]]).optional().describe(described)
            : z.string().optional().describe(described);
    }

    server.tool(
      name,
      `${endpoint.description} Costs ${endpoint.price_usd} in USDC per call, charged to the configured wallet.`,
      shape,
      async (args: Record<string, unknown>) => {
        if (spent + price > BUDGET_USD) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Refusing to call: this would spend $${(spent + price).toFixed(4)}, over the K_DATA_MAX_SPEND_USD budget of $${BUDGET_USD}. Raise the budget to continue.`,
              },
            ],
          };
        }

        // Substitute :params into the path; everything else becomes query string.
        let path = endpoint.path;
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(args)) {
          if (value === undefined || value === null || value === "") continue;
          const token = `:${key}`;
          if (path.includes(token)) path = path.replace(token, encodeURIComponent(String(value)));
          else query.set(key, String(value));
        }
        const url = `${BASE_URL}${path}${query.toString() ? `?${query}` : ""}`;

        try {
          const res = await payingFetch(url, { method: "GET" });
          const body = await res.text();
          if (res.status === 402) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Payment did not go through. The wallet most likely holds no USDC on Base. Fund it and retry.",
                },
              ],
            };
          }
          if (!res.ok) {
            return { isError: true, content: [{ type: "text", text: `HTTP ${res.status}: ${body.slice(0, 500)}` }] };
          }
          spent += price;
          return { content: [{ type: "text", text: body }] };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text", text: `Request failed: ${(err as Error)?.message ?? String(err)}` }],
          };
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
  console.error(
    `k-data-mcp ready — ${catalog.paid_endpoints.length} paid tools, wallet ${account.address}, budget $${BUDGET_USD}`,
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
