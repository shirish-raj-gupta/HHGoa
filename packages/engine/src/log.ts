export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope = 'receipts'): Logger {
  const fmt = (level: string, msg: string, data?: unknown) => {
    const time = new Date().toISOString().slice(11, 19);
    const extra = data === undefined ? '' : ` ${data instanceof Error ? data.message : JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`;
    return `${time} ${level} [${scope}] ${msg}${extra}`;
  };
  return {
    info: (m, d) => console.log(fmt('info', m, d)),
    warn: (m, d) => console.warn(fmt('warn', m, d)),
    error: (m, d) => console.error(fmt('error', m, d)),
    child: (s) => createLogger(`${scope}:${s}`),
  };
}
