// @ts-nocheck
const csv = (value) =>
  new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const enabled = (value) => String(value).toLowerCase() === 'true';

export const config = {
  teamId: process.env.SLACK_TEAM_ID,
  adminIds: csv(process.env.MERITUM_ADMIN_USER_IDS),
  managerIds: csv(process.env.MERITUM_MANAGER_USER_IDS),
  maxGrant: Number.parseInt(process.env.MAX_KUDOS_PER_GRANT || '1000', 10),
  initialAdminKudos: Number.parseInt(process.env.INITIAL_ADMIN_KUDOS || '2500', 10),
  kudosPerInr: Number.parseFloat(process.env.KUDOS_PER_INR || '1'),
  bitrefillApiKey: process.env.BITREFILL_API_KEY,
  livePurchases: enabled(process.env.LIVE_PURCHASES_ENABLED),
  maxRewardPerPurchaseInr: Number.parseInt(process.env.MAX_REWARD_PER_PURCHASE_INR || '100', 10),
  maxRewardPerDayInr: Number.parseInt(process.env.MAX_REWARD_PER_DAY_INR || '300', 10),
};

export function roleFor(slackUserId) {
  if (config.adminIds.has(slackUserId)) return 'ADMIN';
  if (config.managerIds.has(slackUserId)) return 'MANAGER';
  return 'EMPLOYEE';
}
