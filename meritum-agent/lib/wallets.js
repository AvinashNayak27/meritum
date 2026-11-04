// @ts-nocheck
import { config, roleFor } from './config.js';
import { getPool, transaction } from './database.js';

async function ensureUser(client, slackUserId) {
  if (!config.teamId) throw new Error('SLACK_TEAM_ID is required');
  const org = await client.query(
    `insert into organizations (slack_team_id, name) values ($1, $2)
     on conflict (slack_team_id) do update set name = excluded.name returning id`,
    [config.teamId, 'MERITUM Sandbox'],
  );
  const user = await client.query(
    `insert into users (organization_id, slack_user_id, role) values ($1, $2, $3)
     on conflict (organization_id, slack_user_id) do update set role = excluded.role
     returning id, role, status`,
    [org.rows[0].id, slackUserId, roleFor(slackUserId)],
  );
  await client.query(
    'insert into kudos_wallets (organization_id, user_id) values ($1, $2) on conflict (user_id) do nothing',
    [org.rows[0].id, user.rows[0].id],
  );
  if (user.rows[0].role === 'ADMIN' && config.initialAdminKudos > 0) {
    const wallet = await client.query('select id from kudos_wallets where user_id = $1 for update', [user.rows[0].id]);
    const seed = await client.query(
      `insert into kudos_transactions (wallet_id, type, amount, reference_id, description, created_by)
       values ($1, 'GRANT', $2, 'initial_admin_kudos', 'Initial administrator Kudos funding', $3)
       on conflict (wallet_id, type, reference_id) do nothing returning id`,
      [wallet.rows[0].id, config.initialAdminKudos, user.rows[0].id],
    );
    if (seed.rowCount) {
      await client.query(
        'update kudos_wallets set available_points = available_points + $1, version = version + 1, updated_at = now() where id = $2',
        [config.initialAdminKudos, wallet.rows[0].id],
      );
    }
  }
  return { organizationId: org.rows[0].id, ...user.rows[0] };
}

export async function getWallet(slackUserId) {
  return transaction(async (client) => {
    const user = await ensureUser(client, slackUserId);
    const wallet = await client.query(
      'select available_points, reserved_points from kudos_wallets where user_id = $1',
      [user.id],
    );
    return { role: user.role, available: wallet.rows[0].available_points, reserved: wallet.rows[0].reserved_points };
  });
}

export async function readWallet(slackUserId) {
  if (config.adminIds.has(slackUserId)) return getWallet(slackUserId);
  if (!config.teamId) throw new Error('SLACK_TEAM_ID is required');
  const result = await getPool().query(
    `select u.role, coalesce(w.available_points, 0) as available_points,
            coalesce(w.reserved_points, 0) as reserved_points
     from organizations o
     left join users u on u.organization_id = o.id and u.slack_user_id = $2
     left join kudos_wallets w on w.user_id = u.id
     where o.slack_team_id = $1`,
    [config.teamId, slackUserId],
  );
  const wallet = result.rows[0];
  return {
    role: wallet?.role || roleFor(slackUserId),
    available: wallet?.available_points ?? 0,
    reserved: wallet?.reserved_points ?? 0,
  };
}

export async function reserveRedemptionKudos({
  slackUserId,
  amount,
  idempotencyKey,
  productId,
  packageId,
  productName,
}) {
  if (!Number.isInteger(amount) || amount < 1)
    throw new Error('The reward must have a positive whole-number Kudos cost.');
  return transaction(async (client) => {
    const user = await ensureUser(client, slackUserId);
    if (user.status !== 'ACTIVE') throw new Error('Your account is not active for reward redemptions.');
    const walletResult = await client.query(
      'select id, available_points from kudos_wallets where user_id = $1 for update',
      [user.id],
    );
    const wallet = walletResult.rows[0];
    if (!wallet || wallet.available_points < amount) {
      throw new Error(
        `You have ${wallet?.available_points ?? 0} available Kudos, and this reward needs ${amount}. Nothing was purchased.`,
      );
    }
    const pending = await client.query(
      `select id from redemptions where user_id = $1 and status in ('RESERVED', 'PURCHASING', 'PURCHASE_UNKNOWN') limit 1`,
      [user.id],
    );
    if (pending.rowCount) throw new Error('An earlier redemption still needs a status check before you redeem again.');
    const existing = await client.query('select id from redemptions where idempotency_key = $1', [idempotencyKey]);
    if (existing.rowCount)
      throw new Error('This reward request is already being processed, so I stopped to avoid a duplicate purchase.');
    const redemption = await client.query(
      `insert into redemptions (organization_id, user_id, product_id, package_id, product_name, face_value,
        face_currency, kudos_cost, status, idempotency_key)
       values ($1, $2, $3, $4, $5, $6::integer, 'INR', $6::integer, 'RESERVED', $7) returning id`,
      [user.organizationId, user.id, productId, packageId, productName, amount, idempotencyKey],
    );
    await client.query(
      `update kudos_wallets set available_points = available_points - $1, reserved_points = reserved_points + $1,
       version = version + 1, updated_at = now() where id = $2`,
      [amount, wallet.id],
    );
    await client.query(
      `insert into kudos_transactions (wallet_id, type, amount, reference_id, description, created_by)
       values ($1, 'RESERVE', $2, $3, $4, $5)`,
      [wallet.id, amount, idempotencyKey, `Reserved for ${productName}`, user.id],
    );
    return { redemptionId: redemption.rows[0].id, duplicate: false };
  });
}

export async function completeRedemptionKudos({
  slackUserId,
  amount,
  idempotencyKey,
  invoiceId,
  status = 'FULFILLING',
}) {
  return transaction(async (client) => {
    const user = await ensureUser(client, slackUserId);
    const walletResult = await client.query('select id from kudos_wallets where user_id = $1 for update', [user.id]);
    const wallet = walletResult.rows[0];
    const existing = await client.query(
      `select id from kudos_transactions where wallet_id = $1 and type = 'REDEEM' and reference_id = $2`,
      [wallet.id, idempotencyKey],
    );
    if (!existing.rowCount) {
      const reserved = await client.query(
        `update kudos_wallets set reserved_points = reserved_points - $1, version = version + 1,
         updated_at = now() where id = $2 and reserved_points >= $1`,
        [amount, wallet.id],
      );
      if (!reserved.rowCount) throw new Error('The reserved Kudos could not be found for this redemption.');
      await client.query(
        `insert into kudos_transactions (wallet_id, type, amount, reference_id, description, created_by)
         values ($1, 'REDEEM', $2, $3, 'Bitrefill reward redemption', $4)`,
        [wallet.id, amount, idempotencyKey, user.id],
      );
    }
    await client.query(
      'update redemptions set status = $1, invoice_id = coalesce($2, invoice_id), updated_at = now() where idempotency_key = $3',
      [status, invoiceId || null, idempotencyKey],
    );
    return { duplicate: Boolean(existing.rowCount) };
  });
}

export async function failRedemptionKudos({ slackUserId, amount, idempotencyKey, unknown = false }) {
  return transaction(async (client) => {
    const user = await ensureUser(client, slackUserId);
    const walletResult = await client.query('select id from kudos_wallets where user_id = $1 for update', [user.id]);
    const wallet = walletResult.rows[0];
    if (!unknown) {
      const released = await client.query(
        `insert into kudos_transactions (wallet_id, type, amount, reference_id, description, created_by)
         values ($1, 'RELEASE', $2, $3, 'Bitrefill purchase failed; Kudos released', $4)
         on conflict (wallet_id, type, reference_id) do nothing returning id`,
        [wallet.id, amount, idempotencyKey, user.id],
      );
      if (released.rowCount) {
        await client.query(
          `update kudos_wallets set available_points = available_points + $1, reserved_points = reserved_points - $1,
           version = version + 1, updated_at = now() where id = $2 and reserved_points >= $1`,
          [amount, wallet.id],
        );
      }
    }
    await client.query('update redemptions set status = $1, updated_at = now() where idempotency_key = $2', [
      unknown ? 'PURCHASE_UNKNOWN' : 'FAILED',
      idempotencyKey,
    ]);
  });
}

export async function grantKudos({ actorSlackUserId, recipientSlackUserId, amount, reason, sourceEventId }) {
  if (!Number.isInteger(amount) || amount < 1 || amount > config.maxGrant) throw new Error('Invalid Kudos amount');
  if (actorSlackUserId === recipientSlackUserId) throw new Error('You cannot grant Kudos to yourself');
  if (!reason?.trim()) throw new Error('A recognition reason is required');
  return transaction(async (client) => {
    const actor = await ensureUser(client, actorSlackUserId);
    if (!['ADMIN', 'MANAGER'].includes(actor.role)) throw new Error('You are not authorized to grant Kudos');
    const recipient = await ensureUser(client, recipientSlackUserId);
    const recognition = await client.query(
      `insert into recognitions (organization_id, issuer_user_id, recipient_user_id, kudos_amount, reason, source_event_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (organization_id, source_event_id) do nothing returning id`,
      [actor.organizationId, actor.id, recipient.id, amount, reason.trim(), sourceEventId],
    );
    if (!recognition.rowCount) return { duplicate: true };
    const wallet = await client.query('select id from kudos_wallets where user_id = $1 for update', [recipient.id]);
    await client.query(
      'update kudos_wallets set available_points = available_points + $1, version = version + 1, updated_at = now() where id = $2',
      [amount, wallet.rows[0].id],
    );
    await client.query(
      `insert into kudos_transactions (wallet_id, type, amount, reference_id, description, created_by) values ($1, 'GRANT', $2, $3, $4, $5)`,
      [wallet.rows[0].id, amount, recognition.rows[0].id, reason.trim(), actor.id],
    );
    return { duplicate: false };
  });
}

export async function transferKudos({ senderSlackUserId, recipientSlackUserId, amount, reason, sourceEventId }) {
  if (!Number.isInteger(amount) || amount < 1 || amount > config.maxGrant) throw new Error('Invalid Kudos amount');
  if (senderSlackUserId === recipientSlackUserId) throw new Error('You cannot transfer Kudos to yourself');
  if (!reason?.trim()) throw new Error('Please include why you are sending Kudos');
  return transaction(async (client) => {
    const sender = await ensureUser(client, senderSlackUserId);
    const recipient = await ensureUser(client, recipientSlackUserId);
    if (sender.status !== 'ACTIVE' || recipient.status !== 'ACTIVE')
      throw new Error('Both members must have active accounts');
    const transfer = await client.query(
      `insert into kudos_transfers (organization_id, sender_user_id, recipient_user_id, amount, reason, source_event_id)
       values ($1, $2, $3, $4, $5, $6) on conflict (source_event_id) do nothing returning id`,
      [sender.organizationId, sender.id, recipient.id, amount, reason.trim(), sourceEventId],
    );
    if (!transfer.rowCount) return { duplicate: true };
    const wallets = await client.query(
      'select id, user_id, available_points from kudos_wallets where user_id = any($1::uuid[]) order by user_id for update',
      [[sender.id, recipient.id]],
    );
    const senderWallet = wallets.rows.find((wallet) => wallet.user_id === sender.id);
    const recipientWallet = wallets.rows.find((wallet) => wallet.user_id === recipient.id);
    if (!senderWallet || !recipientWallet || senderWallet.available_points < amount)
      throw new Error('Insufficient available Kudos');
    await client.query(
      'update kudos_wallets set available_points = available_points - $1, version = version + 1, updated_at = now() where id = $2',
      [amount, senderWallet.id],
    );
    await client.query(
      'update kudos_wallets set available_points = available_points + $1, version = version + 1, updated_at = now() where id = $2',
      [amount, recipientWallet.id],
    );
    await client.query(
      `insert into kudos_transactions (wallet_id, type, amount, reference_id, description, created_by)
       values ($1, 'TRANSFER_OUT', $2, $3, $4, $5), ($6, 'TRANSFER_IN', $2, $3, $4, $5)`,
      [senderWallet.id, amount, transfer.rows[0].id, reason.trim(), sender.id, recipientWallet.id],
    );
    return { duplicate: false };
  });
}
