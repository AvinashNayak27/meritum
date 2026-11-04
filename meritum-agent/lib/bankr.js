import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url) });

export function configureBankrGateway(env = process.env) {
  const apiKey = env.BANKR_LLM_API_KEY || env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) throw new Error('BANKR_LLM_API_KEY is required for the Bankr LLM Gateway');

  env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL || 'https://llm.bankr.bot';
  env.ANTHROPIC_API_KEY = apiKey;
  delete env.ANTHROPIC_AUTH_TOKEN;
}
