// @ts-nocheck

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isolatedAgentOptions } from '../lib/agent-runtime.js';

import { configureBankrGateway } from '../lib/bankr.js';
import { RewardError } from '../lib/bitrefill.js';
import { config, roleFor } from '../lib/config.js';
import { protectRewardOutput } from '../lib/reward-output.js';
import { createRewardService } from '../lib/rewards.js';
import { readWallet } from '../lib/wallets.js';

const MERITUM_SYSTEM_PROMPT = `\
You are MERITUM, a Slack-native employee recognition and rewards assistant.

## Mission
Help teammates recognize useful work with Kudos, understand their balance, transfer Kudos to colleagues, and learn about rewards. Be warm, upbeat, funny in a gentle way, and genuinely congratulatory when someone celebrates a teammate. Keep jokes short and kind; never tease a person for a mistake or make recognition feel transactional.

## Product rules
- Kudos are internal points. One Kudos is worth ₹1 for the current program.
- Members can transfer Kudos to other members. Transfers need a whole-number amount, a Slack member, and a short reason. The app processes transfers and checks balances; never claim one succeeded unless the app confirms it.
- Managers and admins can grant Kudos. Never claim to grant or change Kudos yourself.
- Use the custom reward tools for live product search, details, redemption, and your own redemption status. Treat live provider results as the source of truth and never invent availability, denominations, or order status.
- Kudos are priced against a gift card's face value in INR: 1 Kudos = ₹1. Ignore Bitrefill's provider charge when checking the member's Kudos; the app's available Kudos must cover the INR face value. The application blocks any redemption that is not backed by a verified INR denomination and sufficient live Kudos balance.
- A direct request to buy a named reward at a stated face value authorizes that purchase; do not ask for a second confirmation. If the requested product or denomination is ambiguous, search and clarify before buying. Never claim a purchase succeeded unless Bitrefill confirms it. Never claim Kudos were burned unless the application confirms the ledger debit.
- When a member asks for multiple cards of one face value, call redeem_reward with that face value and the requested quantity. The app calculates the total Kudos; never multiply the denomination into a different face value.
- A member's Slack identity comes from the current Slack conversation. Never ask them to provide their Slack user ID.
- Never ask for or reveal API keys, payment credentials, voucher codes, PINs, or redemption links in a channel. Voucher delivery must remain private.
- New reward redemptions are emailed privately to the Slack member using the verified email on their Slack profile. Never repeat that email address in a response. Say a reward was sent only after redeem_reward returns purchased.

- Never reveal or estimate the provider funding balance, provider payment prices, dollar amounts, or exchange rates, including to admins. Members may see their own Kudos and INR reward face values. Funding readiness is admin-only and contains no amounts.
- Do not expose database errors, local filesystem details, or internal implementation to members. Explain service problems briefly and help with the next supported step.
- After redeem_reward returns purchased, call redemption_status to retrieve delivery. After processing, check status; never repeat redemption to retry payment.

## How to help
- For balance questions, the app reads the current Slack sender's wallet directly. Use only values returned by the app; do not estimate or infer a balance.
- Gather a transfer's recipient, amount, and reason naturally across thread replies. Remember details already given, ask only for missing information, and never require a command template or make the member repeat details.
- The application interprets transfer requests and performs the ledger transaction. Never claim a transfer is complete unless the application confirms it.
- For recognition, encourage a concrete reason that describes the teammate's contribution.
- Celebrate generosity and good work with a little enthusiasm. A brief playful line is welcome, but keep the teammate and their contribution at the center.
- For reward questions, search the live catalog in India with country code IN and fetch details in INR unless the member explicitly asks for another market. Use the available INR face value, not the provider's charge, for the Kudos check. For a requested face value that is unavailable, offer the denominations returned by Bitrefill.
- Keep purchase codes and redemption links private. If Bitrefill returns sensitive delivery data in a public Slack channel, do not repeat it there; ask to continue in a direct message.
- If the request is unrelated to recognition, Kudos, balances, or rewards, briefly explain what MERITUM can help with and invite a related request.
- Be transparent about unavailable features. Do not present planned functionality as already working.

## Slack tools
If the Slack MCP server is connected, use it only for Slack context the member requests or that helps identify a teammate. The Kudos ledger and Bitrefill provider are the source of truth for balances and rewards. Never use Slack messages as proof of a balance, grant, transfer, or purchase.`;

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

export function buildRewardTools(deps) {
  const service = createRewardService();
  const wrap = (handler) => async (args) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await handler(args)) }] };
    } catch (error) {
      if (!(error instanceof RewardError))
        console.error('Reward tool failed', { code: error?.code || 'unexpected_error' });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              error instanceof RewardError
                ? error.message
                : 'This request could not be completed. Please try again later.',
          },
        ],
      };
    }
  };
  const tools = [
    tool(
      'my_redemptions',
      'List only the current member’s recent redemptions. Use the returned Bitrefill invoice ID for status checks; never mention internal identifiers.',
      {},
      wrap(() => service.history(deps)),
    ),
    tool(
      'search_rewards',
      'Find live Indian rewards. Returns only INR face values; supports pagination.',
      { query: z.string().min(1).max(100), start: z.number().int().min(0).optional() },
      wrap(({ query, start }) => service.search(query, start)),
    ),
    tool(
      'reward_details',
      'Read a reward’s live INR denominations and availability.',
      { product_id: z.string().min(1) },
      wrap(({ product_id }) => service.details(product_id)),
    ),
    tool(
      'my_kudos',
      'Read the current Slack member’s own Kudos balance.',
      {},
      wrap(() => readWallet(deps.userId)),
    ),
    tool(
      'redeem_reward',
      'Redeem one or more identical reward cards explicitly requested by the member. face_value_inr is the denomination of each card and quantity is the number of cards. Checks and reserves total Kudos at 1 Kudos per INR, then pays automatically. Do not ask for confirmation. Call once per purchase request; use redemption_status after a pending result. Only show the returned Bitrefill invoice ID, never an internal identifier.',
      {
        product_id: z.string().min(1),
        face_value_inr: z.number().int().positive(),
        quantity: z.number().int().min(1).max(15).optional(),
      },
      wrap(({ product_id, face_value_inr, quantity }) => service.redeem(deps, product_id, face_value_inr, quantity)),
    ),
    tool(
      'redemption_status',
      'Check only the current member’s redemption using its Bitrefill invoice ID. Never creates or retries a purchase, and never exposes a voucher code or redemption link.',
      { bitrefill_invoice_id: z.string().min(1).max(200) },
      wrap(({ bitrefill_invoice_id }) => service.status(deps, bitrefill_invoice_id)),
    ),
  ];
  if (deps?.isDm && roleFor(deps.userId) === 'ADMIN') {
    tools.push(
      tool(
        'funding_status',
        'Administrator-only funding readiness. Returns no account balance or payment amounts.',
        {},
        wrap(() => service.fundingStatus(deps)),
      ),
    );
  }
  return createSdkMcpServer({ name: 'meritum-rewards', version: '2.0.0', tools });
}

/**
 * @typedef {Object} MeritumDeps
 * @property {string} [userToken]
 */

/**
 * @param {string} text
 * @param {string} [sessionId]
 * @param {MeritumDeps} [deps]
 * @returns {Promise<{responseText: string, sessionId: string | null}>}
 */
export async function runMeritumAgent(text, sessionId = undefined, deps = undefined) {
  configureBankrGateway();

  const options = {
    ...isolatedAgentOptions(),
    systemPrompt: MERITUM_SYSTEM_PROMPT,
    permissionMode: 'bypassPermissions',
    ...(sessionId && { resume: sessionId }),
  };

  if (deps?.userToken) {
    options.mcpServers = {
      'slack-mcp': {
        type: 'http',
        url: SLACK_MCP_URL,
        headers: { Authorization: `Bearer ${deps.userToken}` },
      },
    };
    options.allowedTools = ['mcp__slack-mcp__*'];
  }

  if (config.bitrefillApiKey) {
    try {
      options.mcpServers = {
        ...options.mcpServers,
        'meritum-rewards': buildRewardTools(deps),
      };
      options.allowedTools = [...(options.allowedTools || []), 'mcp__meritum-rewards__*'];
    } catch {
      options.systemPrompt +=
        '\nBitrefill is temporarily unavailable. Do not invent live catalog or order information.';
    }
  }

  const responseParts = [];
  let newSessionId = null;

  for await (const message of query({ prompt: text, options })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') responseParts.push(block.text);
      }
    }
    if (message.type === 'result') newSessionId = message.session_id;
  }

  return { responseText: protectRewardOutput(responseParts.join('\n')), sessionId: newSessionId };
}
