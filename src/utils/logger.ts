import { config } from '../config.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = formatTimestamp();
  const argsStr = args.length > 0 ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${argsStr}`;
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    console.log(formatMessage('info', message, ...args));
  },

  warn(message: string, ...args: unknown[]): void {
    console.warn(formatMessage('warn', message, ...args));
  },

  error(message: string, ...args: unknown[]): void {
    console.error(formatMessage('error', message, ...args));
  },

  debug(message: string, ...args: unknown[]): void {
    if (config.nodeEnv !== 'production') {
      console.debug(formatMessage('debug', message, ...args));
    }
  },
};
