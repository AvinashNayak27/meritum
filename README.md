# MERITUM — AI-Powered Employee Recognition & Rewards Agent

### MERITUM — AI-Powered Employee Recognition & Rewards Agent

**MERITUM** is a Slack-native AI agent that transforms employee recognition into redeemable e-commerce gift cards.

Managers and HR teams can recognize employees by awarding **Kudos points** directly within Slack. Each employee has a personalized Kudos wallet where they can track their points, explore rewards, and redeem them for digital gift cards, vouchers, and mobile recharges.

Powered by **Bitrefill**, MERITUM autonomously discovers suitable e-commerce gift cards, processes purchases using a company-funded wallet, and securely delivers redemption links to employees.

The platform combines **AI-driven reward recommendations, autonomous commerce, secure wallet management, and spending controls** to make employee recognition effortless, personalized, and rewarding.

**Tagline:** _Recognize merit. Reward instantly._

## Lane: 4 — Home-cooked commerce

**The loop:** manager recognition in Slack → employee's Kudos wallet, caps, and idempotency guarantee → Bitrefill REST purchase → private delivery and `delivered` order status.

MERITUM makes a company recognition budget usable from the place teams already talk. A manager grants Kudos for specific work; the employee chooses a live India reward in a Slack DM; the agent creates and pays a Bitrefill invoice from the company-funded balance; and MERITUM follows the order through delivery without exposing the gift code in a channel.

## Demo

- Video: [Cap demo recording](https://cap.so/s/mes7dm5w10ygawb)
- Redeemed Bitrefill demonstration gift: [view redeemed gift](https://www.bitrefill.com/gift/gift-101dc38d-d87e-4439-9199-19df1b4ef09d)

See [DEMO.md](meritum-agent/DEMO.md) for the recording script. The linked demonstration gift has already been redeemed; never publish active voucher codes, PINs, payment addresses, or redemption links.

## Run it (under 15 minutes)

### Prerequisites

- Node.js 20+ and npm
- A Slack Developer Sandbox app configured from [manifest.json](meritum-agent/manifest.json)
- A PostgreSQL/Supabase database
- A Bankr LLM Gateway API key
- A dedicated low-balance Bitrefill account with an API key and event credits

### Setup

```bash
git clone <your-public-repository-url>
cd meritum/meritum-agent
npm install
cp .env.sample .env
```

Fill `.env` with the Slack, database, Bankr, and Bitrefill credentials. Keep the following limits low for the demo and leave purchasing disabled until the real test is ready:

```dotenv
LIVE_PURCHASES_ENABLED=false
MAX_REWARD_PER_PURCHASE_INR=100
MAX_REWARD_PER_DAY_INR=300
```

Apply the schema and start the Slack app:

```bash
npm run db:migrate
slack run
```

To run the real, low-value demo purchase, use a credited Bitrefill account, confirm the limits, then set `LIVE_PURCHASES_ENABLED=true` and restart. A missing or malformed setting keeps purchases off.

## Bitrefill touchpoints (built vs reused)

MERITUM directly integrates the **Bitrefill REST API v2**. We deliberately switched from the Bitrefill MCP/agent route to direct API calls and built our own custom agent tools, so MERITUM can apply product-specific guardrails before any purchase is created.

- **Built:** Slack identity checks; an internal Kudos ledger; manager recognition; live Indian catalog projection; exact denomination and quantity validation; a transactionally reserved wallet; one outstanding redemption per employee; live-purchase switch; per-purchase and daily company face-value limits; Slack-event idempotency; owner-scoped invoice status; and private gift-link delivery. These custom tools prevent the agent from bypassing Kudos, DM-only, payment-currency, ownership, and delivery-safety checks.
- **Reused:** Bitrefill catalog, invoice payment from the company balance, gift-card fulfillment, and final order delivery. The app calls `GET /products/search`, `GET /products/{id}`, `POST /invoices` with `payment_method: "balance"` and `auto_pay: true`, then `GET /invoices/{id}` and `GET /orders/{id}` until the order is `delivered`.
- **Important setup finding:** Bitrefill AutoPay uses the account's primary dashboard payment currency. Set USD as the primary currency in the Bitrefill dashboard before running MERITUM; the REST invoice request does not expose a reliable currency selector, and an account with BTC as primary can create BTC invoices instead.

## Guardrails

The default maximum is **₹100 / 100 Kudos per purchase** and **₹300 / 300 Kudos per program day**, configured by `MAX_REWARD_PER_PURCHASE_INR` and `MAX_REWARD_PER_DAY_INR`. These are code-enforced before an invoice is created. A manager or administrator must approve any larger reward outside the agent, then update the configuration deliberately; the model has no tool to override a cap.

Further guarantees:

- purchases are blocked by default and require `LIVE_PURCHASES_ENABLED=true`;
- only a verified Slack DM can create a redemption;
- the employee must have sufficient available Kudos and a verified Slack email;
- product, stock, country, recipient type, and exact INR denomination are verified live;
- Kudos are reserved before the provider request; ambiguous provider outcomes remain reserved and are reconciled instead of retried;
- a Slack-event-derived idempotency key prevents duplicate purchases; and
- voucher links are delivered privately and provider funding balances, prices, codes, and links are withheld from agent output.

## Architecture

```text
Slack DM / App Home
        │
        ▼
MERITUM agent (Bolt + Claude Agent SDK via Bankr)
        │                 │
        │                 └── Supabase/PostgreSQL: Kudos, reservations, idempotency
        ▼
Bitrefill REST API v2 ──► company balance invoice ──► delivered reward
```

## Verify

```bash
cd meritum-agent
npm run lint
npm run check
npm test
```

## Feedback

See [FEEDBACK.md](meritum-agent/FEEDBACK.md). The builder replaces its prompts with firsthand notes from the real Bitrefill integration before submission.

## Important safety notes

Use a dedicated, low-balance Bitrefill account. Never commit `.env`, API keys, voucher codes, PINs, payment addresses, or redemption links. A completed Bitrefill invoice is not sufficient proof of fulfillment: record the order only when its status is `delivered`.
