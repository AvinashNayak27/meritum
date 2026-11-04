import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGiftDeliveryBlocks } from '../lib/gift-delivery.js';

test('gift delivery uses private HTTPS button attachments only', () => {
  const blocks = buildGiftDeliveryBlocks(['https://gift.example/redeem', 'javascript:alert(1)']);
  assert.equal(blocks[0].type, 'section');
  assert.equal(blocks[1].type, 'actions');
  assert.equal(blocks[1].elements.length, 1);
  assert.equal(blocks[1].elements[0].url, 'https://gift.example/redeem');
  assert.equal(blocks[1].elements[0].action_id, 'open_gift_card_1');
});
