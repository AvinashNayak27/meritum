# MERITUM MVP Implementation Plan

## Product decision record

MERITUM is a Slack-native employee-recognition agent for a single Slack Developer Sandbox workspace. Members can transfer Kudos to one another, managers can grant Kudos, and employees can redeem Kudos for any available Bitrefill product. The application holds the internal point ledger, not a payment wallet.

Real purchases use the project owner's Bitrefill account through Bitrefill REST API bearer authentication. Employees never create Bitrefill accounts or provide payment credentials. The owner account's existing Bitrefill balance funds purchases. The agent does not use a crypto wallet seed or a registered Bitrefill OAuth client. Custom application tools expose live products and owner-scoped redemption operations; no product or package allowlist is applied. A clear member request naming the product and face value authorizes that purchase; clarify ambiguous selections before buying. Kudos are checked against INR face value, independent of provider charge.

The Slack agent uses the Claude Agent SDK through Bankr's Anthropic-compatible LLM Gateway, not a direct Anthropic account. Configure `ANTHROPIC_BASE_URL=https://llm.bankr.bot` and `BANKR_LLM_API_KEY` with a Bankr LLM Gateway key. [Bankr LLM Gateway overview](https://docs.bankr.bot/llm-gateway/overview/)

## Target architecture

```text
Slack Developer Sandbox
  Agent DM / App Home / slash commands / Block Kit
                         |
                         v
TypeScript application (Slack Bolt + Claude Agent SDK)
  Slack gateway -> agent router -> deterministic domain services
                         |                    |
                         |                    +-- PostgreSQL / Supabase
                         |                         users, ledger, redemptions,
                         |                         audit events, encrypted secrets
                         |
                         +-- Bankr LLM Gateway -> Claude model
                         |
                         +-- Bitrefill REST API -> owner account balance
                                                    catalog, invoice, order delivery
```

Run the HTTP/event process and durable worker from the same deployed codebase. The worker may run as a separate process but shares the same Supabase database and transaction model. Do not split the MVP into microservices.

### Trust boundaries

| Component | May do | Must never do |
| --- | --- | --- |
| Claude agent | Interpret requests, discover products, and ask for clarification | Grant Kudos, set authoritative prices, or bypass application checks |
| Slack gateway | Verify request identity, acknowledge interactions, route events | Trust Slack display names or process the same event twice |
| Domain services | Authorize grants, calculate points, reserve/commit/release ledger entries | Accept role, price, product, or amount from model text without validation |
| Bitrefill tool wrapper | Expose custom REST-backed tools, verify INR face value, reserve/burn Kudos, and use the owner's account balance for purchases | Expose the API key, voucher codes, or payment details in public Slack channels/logs |

## Integrations

### Slack Developer Sandbox and Agent experience

1. Provision an upgraded Slack Developer Sandbox and use one workspace for the MVP. Create a manager/admin test user and an employee test user.
2. Scaffold the app with `slack create agent`, selecting the Starter Agent and Claude Agent SDK. Use `slack run` during development and Socket Mode for local event delivery.
3. Enable Agent View and App Home. Subscribe to `assistant_thread_started`, `assistant_thread_context_changed`, `message.im`, `app_home_opened`, `app_context_changed`, `agent_session_stopped`, and `agent_session_title_changed`.
4. Grant the narrowest practical bot scopes: `assistant:write`, `chat:write`, `im:history`, `im:write`, `commands`, `users:read`, and the App Home/event scopes required by the manifest. Add channel/mention scopes only if channel recognition is implemented.
5. Use agent status correctly: set `processing` immediately, post/stream results, then explicitly set `active`; use `suspended` when awaiting a user decision. Slack documents that agent sessions otherwise remain processing until timeout. [Slack agent response loop](https://docs.slack.dev/ai/developing-agents/)

### Bankr LLM Gateway and Claude Agent SDK

1. Create a Bankr LLM Gateway key with LLM Gateway enabled and fund its separate LLM credit balance. Bankr LLM credits are separate from any Bitrefill balance.
2. Configure `ANTHROPIC_BASE_URL=https://llm.bankr.bot` and `BANKR_LLM_API_KEY=<bk_...>`. The app maps this key to the Claude Agent SDK's `ANTHROPIC_API_KEY` environment variable, so SDK requests use the `X-API-Key` authentication accepted by Bankr's `/v1/messages` endpoint. The legacy `ANTHROPIC_AUTH_TOKEN` is accepted as a migration fallback.
3. Default to a low-latency Claude model such as `claude-haiku-4-5`; configure the exact available model through `BANKR_LLM_MODEL`. Use a stronger model only if required for the demo.
4. Use schema-validated Claude parsing for natural-language Kudos transfers across thread replies. Restrict recipient IDs to Slack mentions/handle matches, validate the amount, and let the deterministic wallet service perform the transaction. The purchase executor is intentionally not an LLM tool.
5. Set a daily Bankr gateway budget in the Bankr dashboard so a compromised key cannot consume unbounded LLM credit. [Bankr LLM Gateway overview](https://docs.bankr.bot/llm-gateway/overview/)

### Supabase PostgreSQL

1. Create a Supabase project and use its managed PostgreSQL database; no Supabase Auth, browser client, or service-role key is required for MVP.
2. Use the pooled Supabase connection for normal runtime reads/writes and a direct connection for migrations. Configure both `DATABASE_URL` and `DIRECT_URL`.
3. Use PostgreSQL transactions plus row-level locks/version checks for every balance mutation and redemption transition.
4. Encrypt voucher payloads before storage using `APP_ENCRYPTION_KEY`; store audit metadata only, never voucher codes.
5. Configure backups and retain application audit records for the demo lifecycle.

### Bitrefill REST API

1. Authenticate directly to https://api.bitrefill.com/v2 using BITREFILL_API_KEY as a bearer token. Remove the external Bitrefill MCP server.
2. Use custom search, detail, redemption, history, and status tools. Project only public product fields and INR denominations; exclude provider prices, balances, account details, and raw API errors from model context.
3. Resolve identity from Slack. Check available Kudos before provider operations, verify the live INR denomination, and reserve points atomically. One Kudos buys one rupee of face value.
4. Verify the REST account funding currency is USD, then create an invoice with payment_method balance and auto_pay true. Do not call the pay endpoint separately. The documented REST API has no balance currency selector, so the connected API account must be configured for USD. Never fall back to another currency.
5. Execute a clear redemption request automatically with no confirmation step. Commit points only after confirmed payment; uncertain results retain the reservation and must be reconciled without another payment attempt.
6. Limit invoice/order reads to redemptions owned by the Slack sender. Deliver codes only in DMs. Nonadmins cannot read provider funding; admin readiness returns booleans, never amounts. The agent must not output provider balances or dollar amounts.

## Application design

### Data model

- `organizations`: one sandbox tenant keyed by `slack_team_id`.
- `users`: Slack user identity, role (`EMPLOYEE`, `MANAGER`, `ADMIN`), status.
- `kudos_wallets`: available and reserved balances plus optimistic-lock version.
- `kudos_transactions`: immutable `GRANT`, `TRANSFER_OUT`, `TRANSFER_IN`, `RESERVE`, `RELEASE`, and `REDEEM` entries.
- `kudos_transfer_drafts`: short-lived thread-scoped transfer context so members can provide recipient, amount, and reason across natural-language replies.
- `recognitions`: issuer, recipient, reason, amount, Slack source/event identifier.
- `redemptions`: product/package quote snapshot, currency, Kudos cost, expiry, idempotency key, status.
- `purchase_attempts`: invoice/order identifiers, provider status, request fingerprint, reconciliation history.
- `vouchers`: encrypted redemption data, owner, delivery and first-view timestamps.
- `audit_events`: non-sensitive actor/action/entity metadata.
- `processed_slack_events`: durable Slack event/action idempotency records.
- `integration_secrets`: encrypted integration credentials and rotation metadata.

### Commands and Slack surfaces

- `/meritum give @user <amount> <reason>`: manager/admin recognition grant.
- `/meritum balance`, `/meritum history`: employee wallet and activity.
- `/meritum rewards`, `/meritum redeem`: discovery and redemption entry points.
- `/meritum admin`: live-spend total, redemption statuses, invoice IDs; never voucher codes.
- App Home: private balance, reserved balance, recent activity, reward and history actions.
- Agent DM: natural-language equivalents, including reward discovery and redemption status.

### Redemption state machine

`QUOTED -> AWAITING_CONFIRMATION -> RESERVED -> PURCHASING -> FULFILLING -> DELIVERED`

Terminal/exception states: `EXPIRED`, `REJECTED`, `CANCELLED`, `PURCHASE_UNKNOWN`, `FULFILLMENT_FAILED`, `RECONCILIATION_REQUIRED`.

- A specific purchase request creates one idempotent redemption and reserves Kudos in a database transaction.
- The Bitrefill tool wrapper executes the purchase only after the live balance and denomination checks pass.
- A request timeout after purchase submission becomes `PURCHASE_UNKNOWN`; reconcile the existing invoice/order before considering another attempt.
- Commit `REDEEM` after Bitrefill confirms payment; keep invoice/order fulfillment status separate from Kudos accounting.
- Release reserved Kudos only after a definitive non-purchase/non-delivery outcome.

### Financial policy

- Point conversion: `1 Kudos = ₹1` for the MVP (`100 Kudos = ₹100`). Provider cost is tracked separately from face value.
- Each configured admin receives a one-time initial funding grant of `2,500 Kudos`, recorded in the immutable transaction ledger so retries cannot duplicate the seed.
- Country: India only.
- Live cap: `$5` maximum per order, `$8` maximum cumulative live spend, and one outstanding redemption per employee.
- `LIVE_PURCHASES_ENABLED=false` by default. Test products are mandatory before enabling live mode.
- Peer-to-peer Kudos transfers are allowed and must debit/credit both wallets atomically; cash withdrawal, employee Bitrefill accounts, automatic budget changes, and agent-approved exceptions are not supported.

## Delivery sequence

1. Bootstrap the Slack agent, Supabase migration tooling, environment validation, logging redaction, and health checks.
2. Implement Slack identity mapping, role seed data, App Home, manager grant flow, ledger transactions, and grant DM.
3. Add the MERITUM persona and Bankr-routed Claude transfer-detail parser with validated outputs and persisted thread drafts.
4. Add Bitrefill MCP API-key configuration, custom REST tools, and live catalog access.
5. Gate purchases on an exact INR face value, current available Kudos, idempotent reservation, and private Slack delivery.
6. Reconcile provider invoice/order results and protect voucher delivery data.
7. Execute test-product integration tests, then one low-value live purchase only after the live checklist passes.
8. Record a demo showing recognition, balance, catalog discovery, confirmation, delivered voucher, duplicate-confirmation protection, and over-limit block.

## Verification and release checklist

- Unit-test authorization, point math, ledger transaction invariants, policy caps, quote expiry, and every state transition.
- Integration-test Bitrefill test-product catalog/purchase/order flows and Supabase transaction rollback behavior.
- Test Slack duplicate retries, repeated confirmation clicks, unauthorized grant, insufficient Kudos, out-of-stock/requoted product, timeout after purchase, delayed fulfillment, and Slack DM retry.
- Verify no secret, voucher code, PIN, redemption link, or raw Slack payload is logged.
- Before a live purchase: verify the Bitrefill API key is active, selected package/price, available Bitrefill funds, `$8` remaining cumulative cap, and `LIVE_PURCHASES_ENABLED=true`.
- After the live purchase: save invoice/order ID and non-sensitive audit data; verify the employee can view the voucher privately and a duplicate confirmation creates no second order.
