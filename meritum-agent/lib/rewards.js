// @ts-nocheck
import { createHash } from 'node:crypto';
import { assertUsdInvoice, bitrefillApi, invoicePaid, publicProduct, RewardError, selectReward } from './bitrefill.js';
import { config, roleFor } from './config.js';
import { getPool } from './database.js';
import { completeRedemptionKudos, failRedemptionKudos, readWallet, reserveRedemptionKudos } from './wallets.js';

const repository = {
  async listOwned(userId) {
    const result = await getPool().query(
      `select r.invoice_id as bitrefill_invoice_id, r.product_name, r.face_value, r.kudos_cost, r.status from redemptions r
       join users u on u.id = r.user_id join organizations o on o.id = r.organization_id
       where u.slack_user_id = $1 and o.slack_team_id = $2 and r.invoice_id is not null
       order by r.created_at desc limit 20`,
      [userId, config.teamId],
    );
    return result.rows;
  },
  async saveInvoice(key, invoiceId) {
    await getPool().query(
      "update redemptions set invoice_id = $1, status = 'PURCHASING', updated_at = now() where idempotency_key = $2",
      [invoiceId, key],
    );
  },
  async findOwned(userId, invoiceId) {
    const result = await getPool().query(
      `select r.* from redemptions r join users u on u.id = r.user_id
       join organizations o on o.id = r.organization_id
       where r.invoice_id = $1 and u.slack_user_id = $2 and o.slack_team_id = $3`,
      [invoiceId, userId, config.teamId],
    );
    return result.rows[0];
  },
  async authorizedSpendToday() {
    const result = await getPool().query(
      `select coalesce(sum(kudos_cost), 0)::integer as total
       from redemptions r join organizations o on o.id = r.organization_id
       where o.slack_team_id = $1 and r.created_at >= date_trunc('day', now())
         and r.status in ('RESERVED', 'PURCHASING', 'PURCHASE_UNKNOWN', 'FULFILLING', 'DELIVERED')`,
      [config.teamId],
    );
    return result.rows[0].total;
  },
};

export function createRewardService({
  api = bitrefillApi,
  ledger = { readWallet, reserveRedemptionKudos, completeRedemptionKudos, failRedemptionKudos },
  records = repository,
} = {}) {
  return {
    async history(context) {
      if (!context.userId || !context.isDm) throw new RewardError('Check your rewards in a direct message.');
      return records.listOwned(context.userId);
    },
    async search(query, start = 0) {
      const products = await api(
        `/products/search?${new URLSearchParams({ q: query, start: String(start), limit: '50' })}`,
      );
      if (!Array.isArray(products)) throw new RewardError('The rewards catalog is temporarily unavailable.');
      return {
        products: products.filter((p) => p.country_code === 'IN' && p.currency === 'INR').map(publicProduct),
        next_start: products.length === 50 ? start + 50 : null,
      };
    },
    async details(productId) {
      return publicProduct(await api(`/products/${encodeURIComponent(productId)}`));
    },
    async fundingStatus(context) {
      if (!context.isDm || roleFor(context.userId) !== 'ADMIN')
        throw new RewardError('Only administrators can check reward funding.');
      const funding = await api('/accounts/balance');
      return {
        configured: funding.currency === 'USD',
        available: funding.currency === 'USD' && Number(funding.balance) > 0,
      };
    },
    async redeem(context, productId, amount, quantity = 1) {
      if (!context.userId || !context.messageTs || !context.channelId)
        throw new RewardError('Your Slack identity could not be verified.');
      if (!context.isDm) throw new RewardError('Please redeem in a direct message so your gift card stays private.');
      if (!context.recipient?.email || !context.recipient?.name) {
        throw new RewardError('I could not find your Slack email, so I cannot send this gift card yet.');
      }
      if (!config.livePurchases)
        throw new RewardError('Reward purchases are currently disabled. No purchase was submitted.');
      if (!Number.isSafeInteger(amount) || amount < 1)
        throw new RewardError('Choose a positive whole-number Kudos amount.');
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 15)
        throw new RewardError('Choose between 1 and 15 reward cards in one redemption.');
      const totalKudos = amount * quantity;
      if (totalKudos > config.maxRewardPerPurchaseInr)
        throw new RewardError(
          `This redemption exceeds the ${config.maxRewardPerPurchaseInr} Kudos per-purchase limit. An administrator must approve a larger reward outside the agent.`,
        );
      const spendToday = await records.authorizedSpendToday();
      if (spendToday + totalKudos > config.maxRewardPerDayInr)
        throw new RewardError(
          `This redemption exceeds the ${config.maxRewardPerDayInr} Kudos daily program limit. An administrator must approve it outside the agent.`,
        );
      const wallet = await ledger.readWallet(context.userId);
      if (wallet.available < totalKudos)
        throw new RewardError(`This reward needs ${totalKudos} Kudos. You have ${wallet.available} available.`);
      const funding = await api('/accounts/balance');
      if (funding.currency !== 'USD') {
        throw new RewardError('Reward funding needs administrator attention. No purchase was submitted.');
      }
      const product = await api(`/products/${encodeURIComponent(productId)}`);
      const selection = selectReward(product, amount);
      selection.quantity = quantity;
      const idempotencyKey = createHash('sha256')
        .update(`${config.teamId}:${context.userId}:${context.channelId}:${context.messageTs}`)
        .digest('hex');
      await ledger.reserveRedemptionKudos({
        slackUserId: context.userId,
        amount: totalKudos,
        idempotencyKey,
        productId: product.id,
        packageId: selection.package_id || String(amount),
        productName: quantity === 1 ? product.name : `${product.name} × ${quantity}`,
      });
      const entry = { slackUserId: context.userId, amount: totalKudos, idempotencyKey };
      let invoice;
      let paymentStarted = false;
      try {
        paymentStarted = true;
        invoice = await api('/invoices', {
          method: 'POST',
          body: {
            products: [
              {
                ...selection,
                gift: {
                  recipient_name: context.recipient.name,
                  recipient_email: context.recipient.email,
                  sender_name: 'MERITUM',
                  message: `Your ${product.name} reward from MERITUM`,
                },
              },
            ],
            payment_method: 'balance',
            auto_pay: true,
          },
        });
        if (!invoice.id)
          throw new RewardError('The reward request needs review. Check its status before retrying.', true);
        await records.saveInvoice(idempotencyKey, invoice.id);
        assertUsdInvoice(invoice);
        invoice = await api(`/invoices/${encodeURIComponent(invoice.id)}`);
        if (!invoicePaid(invoice))
          throw new RewardError('Your redemption is processing. Your Kudos remain reserved.', true);
        await ledger.completeRedemptionKudos({ ...entry, invoiceId: invoice.id, status: 'FULFILLING' });
      } catch (error) {
        const unknown = paymentStarted || !(error instanceof RewardError) || error.uncertain;
        await ledger.failRedemptionKudos({ ...entry, unknown });
        return {
          ...(invoice?.id && { bitrefill_invoice_id: invoice.id }),
          status: unknown ? 'processing' : 'failed',
          kudos_reserved: unknown ? totalKudos : 0,
          message: unknown
            ? 'Your redemption needs a status check; your Kudos remain reserved. Do not submit another purchase.'
            : 'The reward could not be purchased. Your Kudos have been released. An administrator may need to check reward funding.',
        };
      }
      return {
        bitrefill_invoice_id: invoice.id,
        status: 'purchased',
        kudos_spent: totalKudos,
        face_value_inr: amount,
        quantity,
        message: 'Redeemed successfully. Your gift card has been sent to your Slack email.',
      };
    },
    async status(context, invoiceId) {
      if (!context.userId || !context.isDm) throw new RewardError('Check your redemption in a direct message.');
      const row = await records.findOwned(context.userId, invoiceId);
      if (!row) throw new RewardError('This redemption was not found in your account.');
      if (!row.invoice_id || ['FAILED', 'EXPIRED'].includes(row.status))
        return { bitrefill_invoice_id: row.invoice_id, status: row.status };
      const invoice = await api(`/invoices/${encodeURIComponent(row.invoice_id)}`);
      const paid = invoicePaid(invoice);
      const orders = [];
      for (const order of invoice.orders || []) {
        orders.push(await api(`/orders/${encodeURIComponent(order.id)}`));
      }
      const delivered =
        orders.length > 0 && orders.every((order) => order.status === 'delivered' || order.delivered_time);
      const giftUrls = orders.map((order) => order.gift_info?.gift_url).filter((url) => typeof url === 'string');
      if (delivered && context.isDm && giftUrls.length) context.giftDeliveryUrls = [...new Set(giftUrls)];
      if (paid) {
        assertUsdInvoice(invoice);
        await ledger.completeRedemptionKudos({
          slackUserId: context.userId,
          amount: row.kudos_cost,
          idempotencyKey: row.idempotency_key,
          invoiceId: row.invoice_id,
          status: delivered ? 'DELIVERED' : 'FULFILLING',
        });
      }
      return {
        bitrefill_invoice_id: row.invoice_id,
        status: delivered ? 'delivered' : paid ? 'purchased' : 'processing',
        kudos_spent: paid ? row.kudos_cost : 0,
        delivery: delivered ? 'sent_to_slack_email' : undefined,
      };
    },
  };
}
