import type { LogLevel, LoggerLike } from "./types.js";

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

export function createLogger(prefix = "@openrol/maps-scrap"): LoggerLike {
  const write = (level: LogLevel, message: string) => {
    const ts = new Date().toISOString();
    const color = COLORS[level];
    process.stderr.write(
      `${ts} ${color}[${prefix}:${level.toUpperCase()}]\x1b[0m ${message}\n`,
    );
  };

  return {
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
