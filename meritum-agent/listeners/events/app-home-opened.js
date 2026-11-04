// @ts-nocheck
import { getWallet } from '../../lib/wallets.js';
import { buildAppHomeView } from '../views/app-home-builder.js';

const SUGGESTED_PROMPTS = [
  { title: 'Show my Kudos', message: 'Show my Kudos balance' },
  { title: 'Recognize a teammate', message: 'How can I send Kudos to a teammate?' },
  { title: 'Explore rewards', message: 'What rewards can I explore?' },
  { title: 'Redemption status', message: 'Show my redemption status' },
];

export async function handleAppHomeOpened({ client, event, context, logger }) {
  try {
    if (event.tab === 'messages') {
      await client.assistant.threads.setSuggestedPrompts({
        channel_id: event.channel,
        title: 'What can MERITUM do for you?',
        prompts: SUGGESTED_PROMPTS,
      });
      return;
    }
    const userId = /** @type {string} */ (context.userId);
    const wallet = await getWallet(userId);
    await client.views.publish({ user_id: userId, view: buildAppHomeView(wallet, context.botUserId) });
  } catch (error) {
    logger.error(`Failed to publish MERITUM Home: ${error}`);
  }
}
