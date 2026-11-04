import { runMeritumAgent } from '../../agent/index.js';
import { sendGiftDelivery } from '../../lib/gift-delivery.js';
import { isBalanceRequest } from '../../lib/intents.js';
import { handleKudosTransfer, hasPendingKudosTransfer } from '../../lib/kudos-transfers.js';
import { recipientFromSlack } from '../../lib/slack-member.js';
import { readWallet } from '../../lib/wallets.js';
import { sessionStore } from '../../thread-context/index.js';
import { buildFeedbackBlocks } from '../views/feedback-builder.js';

/**
 * @param {import('@slack/types').MessageEvent} event
 * @returns {event is import('@slack/types').GenericMessageEvent}
 */
function isGenericMessageEvent(event) {
  return !('subtype' in event && event.subtype !== undefined);
}

/**
 * Handle direct messages and replies in threads the bot is part of.
 * @param {import('@slack/bolt').AllMiddlewareArgs & import('@slack/bolt').SlackEventMiddlewareArgs<'message'>} args
 * @returns {Promise<void>}
 */
export async function handleMessage({ client, context, event, logger, say, sayStream, setStatus }) {
  // Skip message subtypes (edits, deletes, etc.)
  if (!isGenericMessageEvent(event)) return;

  if (event.bot_id) return;

  const isDm = event.channel_type === 'im';
  const isThreadReply = !!event.thread_ts;
  const userId = /** @type {string} */ (event.user || context.userId);

  if (isDm) {
    // DMs are always handled
  } else if (isThreadReply) {
    // Continue either an agent conversation or an in-progress Kudos transfer.
    const session = sessionStore.getSession(event.channel, /** @type {string} */ (event.thread_ts));
    let pendingTransfer = false;
    if (session === null) {
      try {
        pendingTransfer = await hasPendingKudosTransfer(
          client,
          event.channel,
          event.thread_ts,
          userId,
          context.botUserId,
        );
      } catch (error) {
        logger.error(`Failed to recover a Kudos transfer thread: ${error}`);
        await say({
          text: 'I lost the thread details for that Kudos transfer. Please start the request again here, and I’ll keep up this time.',
          thread_ts: event.thread_ts,
        });
        return;
      }
    }
    if (session === null && !pendingTransfer) return;
  } else {
    // Top-level channel messages are handled by app_mentioned
    return;
  }

  try {
    const channelId = event.channel;
    const text = event.text || '';
    const threadTs = event.thread_ts || event.ts;

    if (isBalanceRequest(text)) {
      const wallet = await readWallet(userId);
      const inr = (wallet.available / Number(process.env.KUDOS_PER_INR || 1)).toFixed(2);
      await say({
        text: `You have ${wallet.available} available Kudos (₹${inr}); ${wallet.reserved} reserved. Want to explore a gift card redemption or transfer Kudos to a teammate?`,
        thread_ts: event.thread_ts || event.ts,
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
      contextThreadTs: isDm ? 'dm' : threadTs,
      logger,
    });
    if (handledTransfer) return;

    const existingSessionId = sessionStore.getSession(channelId, threadTs);

    // Add eyes reaction only to the first message (DMs only — channel
    // threads already have the reaction from the initial app_mention)
    if (isDm && !existingSessionId) {
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

    // Run the agent with deps for tool access
    let recipient = null;
    if (isDm) {
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
      isDm,
      recipient,
    };
    const { responseText, sessionId: newSessionId } = await runMeritumAgent(text, existingSessionId ?? undefined, deps);

    // Stream response in thread with feedback buttons
    const streamer = sayStream();
    await streamer.append({ markdown_text: responseText });
    const feedbackBlocks = buildFeedbackBlocks();
    await streamer.stop({ blocks: feedbackBlocks });

    if (isDm && deps.giftDeliveryUrls?.length) {
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
    logger.error(`Failed to handle message: ${e}`);
    await say({
      text: `:warning: Something went wrong! (${e})`,
      thread_ts: event.thread_ts || event.ts,
    });
  }
}
