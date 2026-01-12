/**
 * Logger class that only outputs to console in development mode.
 * Wraps console methods and checks import.meta.env.DEV before logging.
 */
class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  log(...args: unknown[]): void {
    if (import.meta.env.DEV) {
      console.log(`[${this.prefix}]`, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (import.meta.env.DEV) {
      console.error(`[${this.prefix}]`, ...args);
    }
  }
}

// Pre-configured loggers for different modules
export const vaultLogger = new Logger("Vault");
export const cryptoLogger = new Logger("Crypto");
export const uploadLogger = new Logger("Upload");
export const downloadLogger = new Logger("Download");

export default Logger;
