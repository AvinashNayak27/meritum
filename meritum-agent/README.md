# MERITUM Slack Agent

MERITUM is a Slack employee recognition and rewards assistant using Bolt for JavaScript, the Claude Agent SDK through Bankr, Supabase PostgreSQL, and the Bitrefill REST API.

Members can check their own Kudos, transfer Kudos to colleagues, browse live Indian rewards, and redeem a gift card at **1 Kudos = ₹1 of face value**. Administrators receive their configured initial allocation once.

## Rewards

Custom application tools call `https://api.bitrefill.com/v2` using `BITREFILL_API_KEY` as a bearer token. There is no connection to Bitrefill’s MCP server. The Claude SDK uses an in-process tool container called `meritum-rewards` to expose these application functions.

- Search and details return product identity, availability, and INR face values. Provider prices, funding balances, raw errors, and account metadata never enter agent tool results.
- Redemption identifies the sender from the Slack event, checks their available Kudos, verifies the live denomination, and reserves points under a PostgreSQL wallet lock before creating an invoice.
- The app verifies the REST funding currency is USD before creating an invoice with `payment_method: 'balance'` and `auto_pay: true`. Creation pays automatically; there is no second pay request or user confirmation. Non-USD funding blocks creation. Uncertain creation keeps Kudos reserved for reconciliation.
- The account’s REST API currency must be configured as USD in Bitrefill. The documented REST invoice schema does not expose a balance currency selector. The app never assumes that passing an unsupported currency parameter would select USD.
- Confirmed payment burns the reserved Kudos. Uncertain payment keeps them reserved, blocks another pending redemption, and uses status lookup rather than retrying the payment.
- History, status, and vouchers are scoped to the Slack sender and available only in DMs. Nonadmins have no provider balance tool. Admin funding readiness returns booleans only; the agent never displays funding amounts, including to admins.

The SDK subprocess has no built-in shell/file tools, uses a temporary home and working directory, ignores local settings/MCP configuration, and receives only the runtime environment and Bankr credentials. The app’s optional Slack MCP is explicitly configured separately.

## Running

Populate `.env` in this directory using `.env.sample`. Required settings include Slack tokens, `SLACK_TEAM_ID`, `DATABASE_URL`, `BANKR_LLM_API_KEY`, and `BITREFILL_API_KEY`. Keep populated environment files private.

Run `slack run` or `npm start`. Database migrations run before startup. `npm run db:migrate` applies them separately and records completed filenames.

## Source

- `agent/meritum.js`: persona and custom application tool registration.
- `lib/agent-runtime.js`: isolated Claude SDK configuration.
- `lib/bitrefill.js`: direct REST client, response projection, denomination and USD checks.
- `lib/rewards.js`: redemption orchestration and owner-scoped status/history.
- `lib/wallets.js`: transactional Kudos ledger.
- `db/migrations/`: PostgreSQL schema.

References: [Bitrefill API overview](https://docs.bitrefill.com/docs/api-overview), [invoice creation](https://docs.bitrefill.com/reference/post_invoices), [invoice payment](https://docs.bitrefill.com/reference/post_invoices-id-pay), [Bankr gateway](https://docs.bankr.bot/llm-gateway/overview/), [Slack agents](https://docs.slack.dev/ai/developing-agents/).
