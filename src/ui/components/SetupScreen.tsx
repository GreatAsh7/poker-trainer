import { useState } from 'react';
import type { MatchSetup } from '../controller';
import type { BotProfile } from '../../bots/types';

export const BOT_ROSTER: BotProfile[] = [
  { id: 'bot-mara', name: 'Mara', style: 'placeholder' },
  { id: 'bot-dex', name: 'Dex', style: 'placeholder' },
  { id: 'bot-ivo', name: 'Ivo', style: 'placeholder' },
  { id: 'bot-lena', name: 'Lena', style: 'placeholder' },
  { id: 'bot-rook', name: 'Rook', style: 'placeholder' },
];

interface Props {
  onStart: (s: MatchSetup) => void;
  initial?: Partial<MatchSetup>;
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
        {options.map((o) => (
          <button
            key={String(o)}
            role="radio"
            aria-checked={o === value}
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

export function SetupScreen({ onStart, initial }: Props) {
  const [numBots, setNumBots] = useState(initial?.numBots ?? 5);
  const [startingBB, setStartingBB] = useState(initial?.startingBB ?? 100);
  const [hands, setHands] = useState(initial?.hands ?? 50);
  const [rebuy, setRebuy] = useState(initial?.rebuy ?? false);
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
            onStart({ numBots, startingBB, hands, rebuy, seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0, bots: BOT_ROSTER })
          }
          data-testid="start-match"
        >
          Deal me in
        </button>
      </div>
    </div>
  );
}
