/**
 * @param {{ users: { info: (args: { user: string }) => Promise<{ user?: { profile?: { email?: string, real_name?: string }, real_name?: string }> } } }} client
 * @param {string} slackUserId
 */
export async function recipientFromSlack(client, slackUserId) {
  const response = await client.users.info({ user: slackUserId });
  const email = response.user?.profile?.email?.trim();
  const name = response.user?.profile?.real_name?.trim() || response.user?.real_name?.trim();
  if (!email || !name) return null;
  return { email, name };
}
