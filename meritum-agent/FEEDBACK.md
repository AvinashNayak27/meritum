# Builder feedback for Bitrefill

MERITUM uses the Bitrefill REST API directly rather than the MCP or agent integration. That let us build custom tools and apply our own Kudos, identity, payment, and private-delivery guardrails around each purchase.

## What worked

- Native product discovery made it straightforward to find live e-commerce gift cards, and the invoice flow made it easy to purchase with the company balance and send gifts by email.

## What slowed us down

- The documentation did not make clear that AutoPay follows the account's primary dashboard payment currency. We saw low-balance errors and BTC invoices until we manually made USD the primary currency in the Bitrefill dashboard; this was difficult to diagnose, including through agents.

## What would make this better

- Document the primary-currency requirement and expose the selected payment currency clearly in invoice creation. A sandbox test product or a delivery webhook would also make it easier to verify the full agent-driven redemption flow without manual reconciliation.

## Evidence to retain while building

- API surface used: Bitrefill REST API v2 (`GET /products/search`, `GET /products/{id}`, `POST /invoices`, `GET /invoices/{id}`, `GET /orders/{id}`).
- A real purchase was completed and redeemed during development; do not add active gift-card codes, PINs, redemption links, payment addresses, or API keys.
