import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runtime = mkdtempSync(join(tmpdir(), 'meritum-agent-'));
const home = join(runtime, 'home');
mkdirSync(home);

export function isolatedAgentOptions() {
  return {
    cwd: runtime,
    settingSources: [],
    strictMcpConfig: true,
    tools: [],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: tmpdir(),
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      ANTHROPIC_BASE_URL: 'https://llm.bankr.bot',
      ANTHROPIC_API_KEY: process.env.BANKR_LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
      ...(process.env.BANKR_LLM_MODEL ? { ANTHROPIC_MODEL: process.env.BANKR_LLM_MODEL } : {}),
    },
  };
}
