export const MAX_HOURLY_CENTS = 100_000;

const TRC20 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const TX = /^[0-9a-fA-F]{64}$/;

export function isTrc20(value: string) {
  return TRC20.test(value);
}

export function isTronTx(value: string) {
  return TX.test(value);
}

/** USDT cents for accounted milliseconds at an hourly rate stored in cents. */
export function payCents(milliseconds: number, hourlyCents: number) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('bad milliseconds');
  if (!Number.isSafeInteger(hourlyCents) || hourlyCents < 0 || hourlyCents > MAX_HOURLY_CENTS) throw new Error('bad rate');
  const product = BigInt(milliseconds) * BigInt(hourlyCents);
  const amount = (product + 1_800_000n) / 3_600_000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('amount overflow');
  return Number(amount);
}

export function formatUsdt(cents: number) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} USDT`;
}
