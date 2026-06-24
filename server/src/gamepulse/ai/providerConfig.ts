export type AiProviderName = 'openrouter' | 'deepseek' | 'mimo';

export interface ProviderConfig {
  provider: AiProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function resolveProviderConfig(): ProviderConfig | null {
  const preferred = (process.env.AI_PROVIDER || 'deepseek').trim().toLowerCase();

  if (preferred === 'mimo') {
    const apiKey = process.env.MIMO_API_KEY;
    if (!apiKey) return null;
    return {
      provider: 'mimo',
      apiKey,
      baseUrl: process.env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
      model: process.env.MIMO_MODEL || 'mimo-v2.5'
    };
  }

  if (preferred === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    return {
      provider: 'openrouter',
      apiKey,
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v3.2'
    };
  }

  if (preferred !== 'deepseek') return null;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return {
    provider: 'deepseek',
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  };
}

export function providerHeaders(config: ProviderConfig): Record<string, string> {
  return {
    ...(config.provider === 'mimo'
      ? { 'api-key': config.apiKey }
      : { Authorization: `Bearer ${config.apiKey}` }),
    'Content-Type': 'application/json',
    ...(config.provider === 'openrouter'
      ? {
          'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
          'X-Title': 'Game Pulse'
        }
      : {})
  };
}
