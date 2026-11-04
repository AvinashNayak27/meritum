/** @param {string[]} urls */
export function buildGiftDeliveryBlocks(urls) {
  const validUrls = [...new Set(urls)].filter((url) => {
    try {
      return new URL(url).protocol === 'https:';
    } catch {
      return false;
    }
  });
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Your gift card is ready!* Open it below to view and redeem it.' },
    },
    {
      type: 'actions',
      block_id: 'gift_delivery_actions',
      elements: validUrls.slice(0, 15).map((url, index) => ({
        type: 'button',
        text: { type: 'plain_text', text: validUrls.length === 1 ? 'Open gift card' : `Open gift card ${index + 1}` },
        action_id: `open_gift_card_${index + 1}`,
        url,
      })),
    },
  ];
}

/** @param {import('@slack/web-api').WebClient} client @param {string} channel @param {string} threadTs @param {string[]} urls */
export async function sendGiftDelivery(client, channel, threadTs, urls) {
  const blocks = buildGiftDeliveryBlocks(urls);
  if (!blocks[1].elements.length) return false;
  const response = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: 'Your gift card is ready. Open the private gift-card link to redeem it.',
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!response.ok) throw new Error('Gift delivery could not be attached.');
  return true;
}
