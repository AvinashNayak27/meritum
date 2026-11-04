import assert from 'node:assert';
import { describe, it } from 'node:test';

import { buildAppHomeView } from '../../../listeners/views/app-home-builder.js';

describe('buildAppHomeView', () => {
  it('returns a private Home view with wallet balances', () => {
    const view = buildAppHomeView({ available: 500, reserved: 100 }, 'U0BOT');
    assert.strictEqual(view.type, 'home');
    const fields = view.blocks.find((block) => block.type === 'section' && block.fields).fields;
    assert.ok(fields.some((field) => field.text.includes('500')));
    assert.ok(fields.some((field) => field.text.includes('100')));
  });
});
