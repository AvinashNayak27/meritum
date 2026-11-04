// @ts-nocheck
import { config } from './config.js';

export class RewardError extends Error {
  constructor(message, uncertain = false) {
    super(message);
    this.uncertain = uncertain;
  }
}

export async function bitrefillApi(path, { method = 'GET', body } = {}) {
  if (!config.bitrefillApiKey) throw new RewardError('Rewards are temporarily unavailable.');
  const mutation = method !== 'GET';
  let response;
  let payload;
  try {
    response = await fetch(`https://api.bitrefill.com/v2${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.bitrefillApiKey}`, 'Content-Type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    payload = await response.json();
  } catch {
    throw new RewardError(
      'The rewards provider could not confirm the request. Please check redemption status before trying again.',
      mutation,
    );
  }
  if (!response.ok || payload.error || payload.error_code) {
    throw new RewardError(
      'The rewards provider could not complete this request. Please try again later.',
      mutation && (response.status >= 500 || response.status === 408 || response.status === 404),
    );
  }
  if (payload.data === undefined)
    throw new RewardError('The rewards provider returned an unexpected response.', mutation);
  return payload.data;
}

export function publicProduct(product) {
  return {
    id: product.id,
    name: product.name,
    country: product.country_code,
    available: product.in_stock === true,
    face_currency: product.currency,
    denominations:
      product.currency === 'INR' && Array.isArray(product.packages)
        ? product.packages.map((item) => Number(item.value)).filter((value) => Number.isSafeInteger(value) && value > 0)
        : [],
    ...(product.currency === 'INR' && product.range
      ? {
          range: { min: product.range.min, max: product.range.max, step: product.range.step },
        }
      : {}),
  };
}

export function selectReward(product, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new RewardError('Choose a positive whole-number INR face value.');
  if (product.currency !== 'INR' || product.country_code !== 'IN' || product.in_stock !== true) {
    throw new RewardError('This reward is not currently available for INR redemption in India.');
  }
  if (product.recipient_type && product.recipient_type !== 'none')
    throw new RewardError('This reward needs recipient details and is not supported for redemption yet.');
  const selected = product.packages?.find((item) => Number(item.value) === amount);
  if (selected?.id) return { product_id: product.id, package_id: selected.id, quantity: 1 };
  const range = product.range;
  if (range && amount >= Number(range.min) && amount <= Number(range.max) && Number(range.step) > 0) {
    const steps = (amount - Number(range.min)) / Number(range.step);
    if (Math.abs(steps - Math.round(steps)) < 1e-8) return { product_id: product.id, value: amount, quantity: 1 };
  }
  throw new RewardError('That face value is unavailable. Choose one of this reward’s live denominations.');
}

export function assertUsdInvoice(invoice) {
  if (!invoice.id || invoice.payment?.method !== 'balance' || invoice.payment?.currency !== 'USD') {
    throw new RewardError('Reward funding needs administrator attention. No payment was submitted.');
  }
}

export function invoicePaid(invoice) {
  return (
    ['complete', 'payment_confirmed', 'all_delivered'].includes(invoice.status) ||
    ['paid', 'confirmed', 'payment_confirmed', 'complete'].includes(invoice.payment?.status)
  );
}
