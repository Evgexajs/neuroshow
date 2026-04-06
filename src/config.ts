import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export interface Config {
  adapterMode: 'mock' | 'openai';
  openaiApiKey: string;
  openaiDefaultModel: string;
  tokenBudgetPerShow: number;
  port: number;
  dbPath: string;
  nodeEnv: 'development' | 'production' | 'test';
}

export const config: Config = {
  adapterMode: (process.env.ADAPTER_MODE as Config['adapterMode']) || 'mock',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiDefaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1-mini',
  tokenBudgetPerShow: parseInt(process.env.TOKEN_BUDGET_PER_SHOW || '100000', 10),
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || './data/neuroshow.db',
  nodeEnv: (process.env.NODE_ENV as Config['nodeEnv']) || 'development',
};
