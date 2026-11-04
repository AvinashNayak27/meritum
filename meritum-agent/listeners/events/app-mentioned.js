import { runMeritumAgent } from '../../agent/index.js';
import { sendGiftDelivery } from '../../lib/gift-delivery.js';
import { isBalanceRequest } from '../../lib/intents.js';
import { handleKudosTransfer } from '../../lib/kudos-transfers.js';
import { recipientFromSlack } from '../../lib/slack-member.js';
import { readWallet } from '../../lib/wallets.js';
import { sessionStore } from '../../thread-context/index.js';
import { buildFeedbackBlocks } from '../views/feedback-builder.js';

/**
 * Handle app_mention events and run the MERITUM agent.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'app_mention'>} args
 * @returns {Promise<void>}
 */
export async function handleAppMentioned({ client, context, event, logger, say, sayStream, setStatus }) {
  try {
    const channelId = event.channel;
    const text = event.text || '';
    const threadTs = event.thread_ts || event.ts;
    const userId = /** @type {string} */ (event.user || context.userId);

    // Strip the bot mention from the text
    const cleanedText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (isBalanceRequest(cleanedText)) {
      const wallet = await readWallet(userId);
      await say({
        text: `You have ${wallet.available} available Kudos (₹${(wallet.available / Number(process.env.KUDOS_PER_INR || 1)).toFixed(2)}); ${wallet.reserved} reserved. Want to explore a gift card redemption or transfer Kudos to a teammate?`,
        thread_ts: threadTs,
      });
      return;
    }

    const handledTransfer = await handleKudosTransfer({
      client,
      say,
      event,
      text,
      senderSlackUserId: userId,
      botUserId: context.botUserId,
      threadTs,
      contextThreadTs: threadTs,
      logger,
    });
    if (handledTransfer) return;

    if (!cleanedText) {
      await say({
        text: 'Welcome to MERITUM! You can check your Kudos balance, recognize a teammate, or ask about rewards.',
        thread_ts: threadTs,
      });
      return;
    }

    // Add eyes reaction only to the first message (not threaded replies)
    if (!event.thread_ts) {
      await client.reactions.add({
        channel: channelId,
        timestamp: event.ts,
        name: 'eyes',
      });
    }

    // Set assistant thread status with loading messages
    await setStatus({
      status: 'Thinking…',
      loading_messages: [
        'Checking the Kudos details…',
        'Finding a useful next step…',
        'Looking up the rewards flow…',
        'Putting together a clear answer…',
      ],
    });

    // Get conversation session
    const existingSessionId = sessionStore.getSession(channelId, threadTs);

    // Run the agent with deps for tool access
    let recipient = null;
    if (channelId.startsWith('D')) {
      try {
        recipient = await recipientFromSlack(client, userId);
      } catch (error) {
        logger.warn(`Could not resolve Slack member email: ${error instanceof Error ? error.name : 'unknown_error'}`);
      }
    }
    const deps = {
      client,
      userId,
      channelId,
      threadTs,
      messageTs: event.ts,
      userToken: context.userToken,
      isDm: channelId.startsWith('D'),
      recipient,
    };
    const { responseText, sessionId: newSessionId } = await runMeritumAgent(
      cleanedText,
      existingSessionId ?? undefined,
      deps,
    );

    // Stream response in thread with feedback buttons
    const streamer = sayStream();
    await streamer.append({ markdown_text: responseText });
    const feedbackBlocks = buildFeedbackBlocks();
    await streamer.stop({ blocks: feedbackBlocks });

    if (deps.isDm && deps.giftDeliveryUrls?.length) {
      try {
        await sendGiftDelivery(client, channelId, threadTs, deps.giftDeliveryUrls);
      } catch (error) {
        logger.error(
          `Could not attach private gift delivery: ${error instanceof Error ? error.name : 'unknown_error'}`,
        );
      }
    }

    // Store conversation session
    if (newSessionId) {
      sessionStore.setSession(channelId, threadTs, newSessionId);
    }
  } catch (e) {
    logger.error(`Failed to handle app mention: ${e}`);
    await say({
      text: `:warning: Something went wrong! (${e})`,
      thread_ts: event.thread_ts || event.ts,
    });
  }
}
