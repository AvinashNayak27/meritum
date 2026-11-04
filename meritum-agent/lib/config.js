// @ts-nocheck
const csv = (value) =>
  new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const config = {
  teamId: process.env.SLACK_TEAM_ID,
  adminIds: csv(process.env.MERITUM_ADMIN_USER_IDS),
  managerIds: csv(process.env.MERITUM_MANAGER_USER_IDS),
  maxGrant: Number.parseInt(process.env.MAX_KUDOS_PER_GRANT || '1000', 10),
  initialAdminKudos: Number.parseInt(process.env.INITIAL_ADMIN_KUDOS || '2500', 10),
  kudosPerInr: Number.parseFloat(process.env.KUDOS_PER_INR || '1'),
  bitrefillApiKey: process.env.BITREFILL_API_KEY,
  livePurchases: 'true',
  maxOrderUsd: Number.parseFloat(process.env.MAX_LIVE_SPEND_PER_ORDER_USD || '5'),
  maxTotalUsd: Number.parseFloat(process.env.MAX_LIVE_SPEND_TOTAL_USD || '8'),
};

export function roleFor(slackUserId) {
  if (config.adminIds.has(slackUserId)) return 'ADMIN';
  if (config.managerIds.has(slackUserId)) return 'MANAGER';
  return 'EMPLOYEE';
}
