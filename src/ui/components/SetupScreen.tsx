import { useState } from 'react';
import type { MatchSetup } from '../controller';
import type { BotProfile, BotStyle } from '../../bots/types';

const NAMES = ['Mara', 'Dex', 'Ivo', 'Lena', 'Rook'];

export type Difficulty = 'mixed' | 'expert' | 'easy';

/** Bot line-ups per difficulty (first N are used for smaller tables). */
const LINEUPS: Record<Difficulty, BotStyle[]> = {
  mixed: ['tag', 'lag', 'expert', 'nit', 'station'],
  expert: ['expert', 'expert', 'expert', 'expert', 'expert'],
  easy: ['station', 'nit', 'station', 'tag', 'nit'],
};

export const DIFFICULTY_INFO: Record<Difficulty, { label: string; blurb: string }> = {
  mixed: { label: 'Mixed table', blurb: 'One of each style: solid, aggressive, expert, tight-passive and a calling station.' },
  expert: { label: 'Expert table', blurb: 'Every bot plays the strongest balanced strategy and adapts to you.' },
  easy: { label: 'Softer table', blurb: 'Mostly loose-passive and tight-passive players: practise value betting.' },
};

export function rosterFor(d: Difficulty): BotProfile[] {
  return LINEUPS[d].map((style, i) => ({ id: `bot-${NAMES[i].toLowerCase()}`, name: NAMES[i], style }));
}

interface Props {
  onStart: (s: MatchSetup) => void;
  initial?: Partial<MatchSetup>;
  reportsCount?: number;
  onShowReports?: () => void;
}

function Segmented<T extends string | number>({
  label, value, options, onChange, format,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div className="field">
      <span className="field__label" id={`lbl-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`lbl-${label}`}>
        {options.map((o, i) => (
          <button
            key={String(o)}
            role="radio"
            aria-checked={o === value}
            tabIndex={o === value ? 0 : -1}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const next = options[(i + d + options.length) % options.length];
              onChange(next);
              const sib = (e.currentTarget.parentElement?.children[(i + d + options.length) % options.length] as HTMLElement | undefined);
              sib?.focus();
            }}
            className={`segmented__opt ${o === value ? 'segmented__opt--on' : ''}`}
            onClick={() => onChange(o)}
          >
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SetupScreen({ onStart, initial, reportsCount = 0, onShowReports }: Props) {
  const [numBots, setNumBots] = useState(initial?.numBots ?? 5);
  const [startingBB, setStartingBB] = useState(initial?.startingBB ?? 100);
  const [hands, setHands] = useState(initial?.hands ?? 50);
  const [rebuy, setRebuy] = useState(initial?.rebuy ?? false);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'mixed');
  return (
    <div className="setup">
      <div className="setup__card">
        <div className="setup__brand">
          <span className="setup__suits" aria-hidden>
            ♠ ♥ ♦ ♣
          </span>
          <h1>Poker Trainer</h1>
          <p>No-Limit Hold'em practice against strategic bots, with a coaching report after every match.</p>
        </div>
        <Segmented label="Players" value={numBots + 1} options={[2, 3, 4, 5, 6]} onChange={(v) => setNumBots(v - 1)} format={(v) => (v === 2 ? 'Heads-up' : `${v}-max`)} />
        <Segmented label="Starting stack" value={startingBB} options={[20, 50, 100, 150, 200]} onChange={setStartingBB} format={(v) => `${v} BB`} />
        <Segmented label="Match length" value={hands} options={[25, 50, 100]} onChange={setHands} format={(v) => `${v} hands`} />
        <Segmented label="Opponents" value={difficulty} options={['mixed', 'expert', 'easy'] as Difficulty[]} onChange={setDifficulty} format={(v) => DIFFICULTY_INFO[v].label} />
        <p className="setup__hint">{DIFFICULTY_INFO[difficulty].blurb}</p>
        <div className="field">
          <span className="field__label">Rebuy</span>
          <label className="toggle">
            <input type="checkbox" checked={rebuy} onChange={(e) => setRebuy(e.target.checked)} />
            <span className="toggle__track" aria-hidden />
            <span>{rebuy ? 'Rebuy automatically if you go broke' : 'Match ends if you go broke'}</span>
          </label>
        </div>
        <p className="setup__blinds">Blinds 1/2 · {startingBB * 2} chips each</p>
        <button
          className="btn btn--primary btn--large"
          autoFocus
          onClick={() =>
            onStart({ numBots, startingBB, hands, rebuy, difficulty, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, bots: rosterFor(difficulty) })
          }
          data-testid="start-match"
        >
          Deal me in
        </button>
        {reportsCount > 0 && onShowReports && (
          <button className="btn-ghost setup__reports" onClick={onShowReports}>
            View your last report and progress ({reportsCount} saved)
          </button>
        )}
      </div>
    </div>
  );
}
