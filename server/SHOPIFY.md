# Shopify in the agent (Shop MCP)

The agent (`agent.py`) can find and open checkouts for real products, but **only when you ask for Shopify by
name**. Built for the Gemini 4 NYC Shopify Challenge
([brief](https://gist.github.com/ryan-ormsby/51a14672336a8c2c16ea32e26e708235)): *a judge must be able to make a
real purchase through the project.*

## How to use it
In the Assistant chat:

| You type | What happens |
|---|---|
| Any message that doesn't contain "Shopify" | **The agent is exactly as before.** Same instructions, same tools. Shopify isn't offered to the model |
| "Use **Shopify** to find illuminated exit signs" | `shopify_search` / `shopify_product`: live products from Shopify merchants, with seller, price and link |
| "Use **Shopify** to **buy** 2 of the glow-in-the-dark exit signs" | Also `shopify_create_checkout`: one real checkout per seller. The answer ends with each checkout link. **You pay on the merchant's page** |

"Shop MCP" and "shop.dev" also count as naming Shopify. A buy request is a message naming Shopify that also says
buy, purchase, order, check out or pay for. Only the current message counts: earlier messages never unlock Shopify.

## Rules followed (from the brief)
- **Checkouts are real.** Paying on the merchant's checkout page places a real order with real money.
- **Purchases happen on the merchant's page.** One checkout per merchant; the agent hands over `continue_url`.
  This server **never completes a checkout** and needs no Shop account.
- **Live data.** Products are fetched when asked; nothing is cached; images are not re-hosted.
- **Links exactly as returned.** Checkout links are appended to the answer by code, character for character;
  the model is told to copy product links with every query parameter.

## How it works
- `shop_mcp.py` calls `https://mcp.shop.com` directly (no key, no account). The server speaks the stateless MCP
  revision `2026-07-28`: every request carries the `MCP-Protocol-Version`, `Mcp-Method` and (for `tools/call`)
  `Mcp-Name` headers, plus protocol fields in `params._meta`.
- Tools used: `search_catalog`, `get_product`, `create_checkout`. Results are trimmed to title, price (converted
  from minor units), availability, seller, product URL and checkout link.
- Two gates in `agent.py`: Shopify tools are added to the model's tool list only when the message names Shopify,
  the checkout tool only when it also asks to buy; `call_tool` refuses them otherwise.
- The reply gains a `shop` field (`products`, `checkouts`) only on Shopify messages, for a future panel.

## Settings (`server/.env`)
| Variable | Default | What |
|---|---|---|
| `SHOPIFY` | `1` | `0` turns the Shopify tools off entirely |
| `SHOP_MCP_URL` | `https://mcp.shop.com` | Shop MCP endpoint |

Docs: [shop.dev/docs](https://shop.dev/docs) · [Carts and checkout](https://shop.dev/docs/checkout.md) ·
[Tools](https://shop.dev/docs/tools.md)
