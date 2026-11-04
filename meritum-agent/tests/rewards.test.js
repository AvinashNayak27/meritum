import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUsdInvoice, publicProduct, RewardError, selectReward } from '../lib/bitrefill.js';
import { createRewardService } from '../lib/rewards.js';

const context = {
  userId: 'U_EMPLOYEE',
  channelId: 'D1',
  messageTs: '1.1',
  isDm: true,
  recipient: { name: 'Employee Name', email: 'employee@example.com' },
};
const product = {
  id: 'swiggy-money-india',
  name: 'Swiggy Money',
  country_code: 'IN',
  currency: 'INR',
  in_stock: true,
  recipient_type: 'none',
  packages: [{ id: 'swiggy<&>100', value: '100', price: 1.25 }],
  balance: 999,
  payment: { currency: 'USD', price: 1.25 },
};
function fixture({ available = 100, currency = 'USD', payError = false, paid = true } = {}) {
  const calls = [];
  const invoice = { id: 'invoice-1', status: 'unpaid', payment: { method: 'balance', currency }, orders: [] };
  const ledger = {
    readWallet: async () => ({ available }),
    reserveRedemptionKudos: async (args) => {
      calls.push(['reserve', args]);
      return { redemptionId: 'redemption-1' };
    },
    completeRedemptionKudos: async (args) => calls.push(['complete', args]),
    failRedemptionKudos: async (args) => calls.push(['fail', args]),
  };
  const records = { saveInvoice: async (...args) => calls.push(['save', args]), findOwned: async () => null };
  const api = async (path, options) => {
    calls.push([path, options]);
    if (path.startsWith('/products/')) return product;
    if (path === '/accounts/balance') return { currency };
    if (path === '/invoices') {
      if (payError) throw new RewardError('Uncertain payment', true);
      return invoice;
    }
    if (path === '/invoices/invoice-1') return { ...invoice, status: paid ? 'complete' : 'pending' };
    throw new Error('Unexpected API request');
  };
  return { service: createRewardService({ api, ledger, records }), calls };
}

test('insufficient Kudos blocks every provider request', async () => {
  const { service, calls } = fixture({ available: 99 });
  await assert.rejects(service.redeem(context, product.id, 100), /100 Kudos/);
  assert.deepEqual(calls, []);
});

test('catalog projection excludes funding and provider prices', () => {
  const result = publicProduct(product);
  assert.deepEqual(result.denominations, [100]);
  assert.doesNotMatch(JSON.stringify(result), /USD|price|balance|payment/);
  assert.throws(() => selectReward(product, 200), /unavailable/);
});

test('non-USD funding blocks automatic purchase before reservation', async () => {
  const { service, calls } = fixture({ currency: 'BTC' });
  await assert.rejects(service.redeem(context, product.id, 100), /funding needs administrator/);
  assert.deepEqual(
    calls.map(([path]) => path),
    ['/accounts/balance'],
  );
});

test('USD balance redemption reserves exactly INR face value before purchase', async () => {
  const { service, calls } = fixture();
  const result = await service.redeem(context, product.id, 100);
  assert.equal(result.kudos_spent, 100);
  assert.equal(result.bitrefill_invoice_id, 'invoice-1');
  assert.equal('redemption_id' in result, false);
  const create = calls.find(([path]) => path === '/invoices');
  assert.deepEqual(create[1].body, {
    products: [
      {
        product_id: product.id,
        package_id: 'swiggy<&>100',
        quantity: 1,
        gift: {
          recipient_name: 'Employee Name',
          recipient_email: 'employee@example.com',
          sender_name: 'MERITUM',
          message: 'Your Swiggy Money reward from MERITUM',
        },
      },
    ],
    payment_method: 'balance',
    auto_pay: true,
  });
  assert.ok(calls.findIndex(([p]) => p === 'reserve') < calls.indexOf(create));
  assert.equal(calls.find(([p]) => p === 'complete')[1].amount, 100);
  assert.doesNotMatch(JSON.stringify(result), /USD|price|balance/);
});

test('multiple identical cards use the requested quantity and reserve the total Kudos', async () => {
  const { service, calls } = fixture({ available: 200 });
  const result = await service.redeem(context, product.id, 100, 2);
  const create = calls.find(([path]) => path === '/invoices');
  assert.equal(create[1].body.products[0].quantity, 2);
  assert.equal(calls.find(([path]) => path === 'reserve')[1].amount, 200);
  assert.equal(calls.find(([path]) => path === 'complete')[1].amount, 200);
  assert.equal(result.kudos_spent, 200);
  assert.equal(result.face_value_inr, 100);
  assert.equal(result.quantity, 2);
});

test('missing Slack email blocks purchase before a provider call', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.redeem({ ...context, recipient: null }, product.id, 100), /Slack email/);
  assert.deepEqual(calls, []);
});

test('uncertain payments remain reserved and are never retried', async () => {
  const { service, calls } = fixture({ payError: true });
  const result = await service.redeem(context, product.id, 100);
  assert.equal(result.status, 'processing');
  assert.equal(calls.filter(([p]) => p === '/invoices').length, 1);
  assert.equal(calls.filter(([p]) => p.endsWith('/pay')).length, 0);
  assert.equal(calls.find(([p]) => p === 'fail')[1].unknown, true);
  assert.equal(
    calls.some(([p]) => p === 'complete'),
    false,
  );
});

test('nonadmins cannot call funding API; users cannot query someone else’s invoice', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.fundingStatus(context), /administrators/);
  await assert.rejects(service.status(context, 'someone-elses-redemption'), /not found/);
  assert.deepEqual(calls, []);
});

test('public channels cannot redeem and incomplete payment cannot burn Kudos', async () => {
  const { service, calls } = fixture({ paid: false });
  await assert.rejects(service.redeem({ ...context, isDm: false }, product.id, 100), /direct message/);
  assert.deepEqual(calls, []);
  const result = await service.redeem(context, product.id, 100);
  assert.equal(result.status, 'processing');
  assert.equal(
    calls.some(([p]) => p === 'complete'),
    false,
  );
  assert.throws(() => assertUsdInvoice({ id: 'i', payment: { method: 'bitcoin', currency: 'USD' } }));
});

test('provider dollar values are blocked at the final response boundary', async () => {
  const { protectRewardOutput } = await import('../lib/reward-output.js');
  for (const text of ['Balance: $25', 'USD 25.50', '25 USD', '25 dollars', 'Bitrefill balance is 25']) {
    assert.doesNotMatch(protectRewardOutput(text), /25/);
  }
  assert.equal(protectRewardOutput('You have 100 Kudos (₹100).'), 'You have 100 Kudos (₹100).');
});

test('raw REST errors with balance and prices never escape', async () => {
  const { bitrefillApi } = await import('../lib/bitrefill.js');
  const { config } = await import('../lib/config.js');
  const originalFetch = globalThis.fetch;
  const originalKey = config.bitrefillApiKey;
  try {
    config.bitrefillApiKey = 'test-key';
    globalThis.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Required $40; account balance $25', error_code: 'balance_too_low' }),
    });
    await assert.rejects(
      bitrefillApi('/invoices/test/pay', { method: 'POST' }),
      (error) => !/25|40|\$|balance/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    config.bitrefillApiKey = originalKey;
  }
});
