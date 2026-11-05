# Architecture

How the Copper State Labs app fits together. Each module adds a section at the
end (see [Adding a module](#adding-a-module)) when it changes how the app
works: new pages, tables or AI calls.

_Fictional — for educational use._

## The starter app (Module 0)

A Next.js app that builds, runs and deploys with **no environment variables**.
A Google AI Studio key is optional until a module needs one.

| Piece | Where | What it does |
|---|---|---|
| Pages | `app/` | `layout.tsx` sets the fonts and theme; `page.tsx` is the placeholder home page |
| Brand components | `components/copper/` | `Logo`, `SiteHeader`, `SiteFooter`, `ModeToggle` |
| UI kit | `components/ui/` (shadcn), `components/ai-elements/` (AI Elements) | The only UI libraries the app uses |
| Setup card | `components/setup-required.tsx` | `<SetupRequired service="ai" />`, shown instead of a page whose service isn't configured |
| Company catalog | `lib/copper/catalog.ts`, `lib/copper/data/catalog.json` | Product, plan and privacy facts from the Product Bible (Sections 3, 4, 8 and 10). Pages read prices and plan details from here instead of typing them (added in the Module 1 starter) |
| AI wrapper | `lib/ai/call.ts` | `callText` and `callObject`: every model call goes through these and is logged to the terminal |
| Models and prices | `lib/ai/models.ts`, `lib/ai/pricing.ts` | The approved Gemini models and their token prices |
| Module checks | `specs/module-N/`, `scripts/check.mjs` | Each module's spec, instructions, rubric and acceptance tests; `npm run check` runs them |

## Data flow

1. A user opens a page in `app/`.
2. Server code checks what's configured (`isAiConfigured()`). If the key is
   missing, the page renders `<SetupRequired />` instead of crashing.
3. Data comes from files under `lib/copper/data/`, except where a module has
   moved it to a database: Module 2 part 2 moves stock to a Supabase
   `inventory` table, read through `lib/copper/inventory.ts`. Facts that don't
   change daily (prices, colors) stay in the files.
4. AI requests go through `callText` / `callObject` in `lib/ai/call.ts`, which
   calls Google and then prints one `[ai_calls]` line: `module`, `feature`,
   `model`, tokens, `cost_usd`, `latency_ms`, `ok`.

```ts
const { text } = await callText(
  { module: 2, feature: "ask-copper" },
  { prompt },
);
```

## Two kinds of "AI tiers"

Don't mix these up:

- **Copper State Labs' product tiers** (On-device, Raw Ore, Refined, the
  Copper Cloud) are part of the fictional company. They are facts in the
  [Product Bible](copper-state-labs/product-bible.md) and rows in the `ai_tiers`
  table.
- **The models this app calls** are real Claude models listed in
  `lib/ai/models.ts`. Their cost is logged in `ai_calls`.

## Decisions

- **No environment variables required.** Every service is optional, so a fresh
  clone builds and deploys before any accounts are set up.
- **One AI wrapper.** Routing every call through `lib/ai/call.ts` gives one
  place to log cost and latency per module and feature.
- **No authentication or row-level security yet.** They arrive in a later
  module.

## Adding a module

When a module changes how the app fits together, add a section here:

```md
## Module N: <feature name>

**Summary:** one or two sentences: what this adds and why.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/...` | |
| Components | `components/...` | |
| Data | `lib/copper/data/...` | Data files added |
| AI calls | `lib/ai/call.ts` (module, feature) | Model, prompt purpose, expected cost per call |

**Data flow:** user action → page → server code → database / model → response.

**Decisions and trade-offs:** what you chose, the alternatives, and why.

**Risks and open questions:** cost, privacy, accuracy or safety risks, and how
you handle them.
```

## Module 2: Ask Copper

**Summary:** A floating chat panel on the landing page where shoppers ask about
prices, colors and stock. Copper answers with tools (code that reads the
catalog and stock list) instead of guessing, and the panel shows each step.

| Piece | Where | What it does |
|---|---|---|
| Page / route | `app/page.tsx` | Renders the panel and passes it `isAiConfigured()`. No new routes |
| Components | `components/copper/ask-copper.tsx` | Launcher, side panel, tools on/off chats, stations and tool cards |
| Server Action | `lib/copper/assistant/ask.ts` | `askCopper()` streams the question and returns a live `Progress` |
| Tools | `lib/copper/assistant/tools.ts` | `get_products`, `get_prices`, `calculate_cost`, `check_availability` |
| Instructions | `lib/copper/assistant/instructions.ts` | Copper's system prompt, sent only when tools are on |
| Data | Supabase `inventory` table (`supabase/migrations/20261029000000_inventory.sql`) | Stock list, read fresh by `readInventory()`; it returns `null` when stock can't be read |
| AI calls | `lib/ai/call.ts` (module 2, `ask-copper`) | `callStream`, with thought summaries; up to 5 steps with tools |

**Data flow:** shopper question → panel → `askCopper()` → `callStream` → model
→ tool runs on the server (catalog / stock) → streamed `Progress` updates →
panel redraws the stations and the reply.

**Decisions and trade-offs:** Tools on and tools off are separate chats, so the
tools-off model can't copy answers the tools worked out. Prices and stock are
never typed into code or instructions; they come from the catalog and
`readInventory()`. The Server Action returns right away and streams in the
background so the panel can show progress.

**Risks and open questions:** With tools off the model can invent prices (the
panel labels this). Each question costs a model call, logged to `ai_calls`.

## Module 2 extension: compare_products

**Summary:** A fifth Ask Copper tool, added only in `copper-m2-ext`. It puts two
products side by side (price, features, which is cheaper) and adds today's
stock for each, so one question like "Copper Home vs Copper Notes: which is
cheaper, and which can I get this week?" is answered from one tool call.

| Piece | Where | What it does |
|---|---|---|
| Tool | `lib/copper/assistant/tools.ts` | `compare_products` takes exactly two different product ids |
| Instructions | `lib/copper/assistant/instructions.ts` | One sentence telling Copper to use it for comparisons |
| Tests | `tests/compare-products.test.ts` | Price gap, stock merge, restock date, stock-down and bad input |

**Data flow:** the tool reads price and features from the catalog and calls
`checkAvailability()` for each product, so stock is read fresh from Supabase
and reports "unavailable" instead of guessing when it can't be read.

**Decisions and trade-offs:** Nothing is typed into the tool; "available now"
means at least one color is in stock or low stock. Adding a fifth tool breaks
two protected Module 2 checks that expect exactly four tools (AC-M2.8 and
AC-M2.14). That is expected here and does not affect `copper-m2`.

**Risks and open questions:** Each comparison reads stock twice (once per
product). Price is per product, not per color, so there is no "cheapest color".
