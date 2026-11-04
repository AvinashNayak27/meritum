# Demo runbook

Record a two-to-three minute screen capture in a Slack Developer Sandbox. Use a dedicated, low-balance Bitrefill account and a reward that the team can redeem.

1. Show the App Home wallet for the employee and the configured `MAX_REWARD_PER_PURCHASE_INR` and `MAX_REWARD_PER_DAY_INR` values in the private environment configuration; do not show secrets.
2. Have a manager award Kudos with a concrete recognition reason.
3. In a direct message, ask MERITUM to find a specific Indian reward and redeem a live, allowed denomination. Show the employee's balance before and after the reservation.
4. Show the Bitrefill invoice ID returned by the app. The agent must initiate the purchase; do not create the invoice by hand.
5. Ask for redemption status until the Bitrefill order reports `delivered`. Show the private Slack delivery button or the user's reward email, with all codes, PINs and links masked.
6. Demonstrate one guardrail: request a reward over the cap and show that no invoice is created. Then show that a second request with the same Slack event is deduplicated.

Before recording, add the final video URL to the README. Never commit an active gift-card code, invoice payment address, API key, or redemption link.
