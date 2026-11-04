/**
 * @param {{ available: number, reserved: number }} wallet
 * @param {string | null} [botUserId]
 * @returns {import('@slack/types').HomeView}
 */
export function buildAppHomeView(wallet, botUserId = null) {
  return {
    type: 'home',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'MERITUM — My Rewards' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Recognize helpful work, share Kudos with teammates, and redeem rewards from your balance. 1 Kudos = ₹1.',
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Available Kudos*\n${wallet.available}` },
          { type: 'mrkdwn', text: `*Reserved Kudos*\n${wallet.reserved}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Ask for your balance, explore rewards, or check a redemption${botUserId ? ` in a DM with <@${botUserId}>` : ''}.`,
          },
        ],
      },
    ],
  };
}
