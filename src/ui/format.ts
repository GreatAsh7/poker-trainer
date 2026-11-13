export const BB = 2;

export function fmtChips(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtBB(n: number, bb = BB): string {
  const v = n / bb;
  const s = Number.isInteger(v) ? v.toString() : v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${s} BB`;
}

export function fmtPct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtSigned(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtChips(Math.abs(n))}`;
}
