import { memo } from 'react';
import { fmtChips } from '../format';

const DENOMS = [
  { v: 500, c: 'chip--purple' },
  { v: 100, c: 'chip--black' },
  { v: 25, c: 'chip--green' },
  { v: 5, c: 'chip--red' },
  { v: 1, c: 'chip--white' },
];

/** Break an amount into at most `max` chip discs for a believable stack. */
function discs(amount: number, max = 6): string[] {
  const out: string[] = [];
  let rest = amount;
  for (const d of DENOMS) {
    while (rest >= d.v && out.length < max) {
      out.push(d.c);
      rest -= d.v;
    }
  }
  if (out.length === 0 && amount > 0) out.push('chip--white');
  return out.reverse();
}

export const ChipStack = memo(function ChipStack({ amount, showLabel = true }: { amount: number; showLabel?: boolean }) {
  const ds = discs(amount);
  return (
    <div className="chipstack">
      <div className="chipstack__discs" aria-hidden>
        {ds.map((c, i) => (
          <span key={i} className={`chip ${c}`} style={{ transform: `translateY(${-i * 3}px)` }} />
        ))}
      </div>
      {showLabel && <span className="chipstack__label">{fmtChips(amount)}</span>}
    </div>
  );
});
