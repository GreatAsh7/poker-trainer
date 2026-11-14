import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, LegalActions, Street } from '../../engine/game';
import { clampTo, defaultRaiseTo, potOdds, presetsFor, stepFor, type PresetContext } from '../presets';
import { fmtBB, fmtChips } from '../format';

interface Props {
  legal: LegalActions | null;
  street: Street;
  pot: number;
  currentBet: number;
  bigBlind: number;
  preflopRaises: number;
  limpers: number;
  /** show the "you need X% equity" helper */
  showPotOdds?: boolean;
  /** decision timer read-out, e.g. "12 s left" */
  timerText?: string;
  /** chips each player has committed this hand (for pot odds) */
  totals: readonly number[];
  heroPi: number;
  /** text shown when it is not the hero's turn */
  waitingText: string;
  onAct: (a: Action) => void;
  /** monotonically increasing id of the decision (resets the slider) */
  decisionKey: string;
}

const PLACEHOLDER_PRESETS = ['', '', '', '', ''].map((label, i) => ({ label, to: -1 - i, hint: '' }));

const ALLIN_ONLY = (to: number) => [
  ...['', '', '', ''].map((label, i) => ({ label, to: -1 - i, hint: '' })),
  { label: 'All-in', to, hint: 'All-in is the only raise possible' },
];

export function ActionBar(p: Props) {
  const { legal } = p;
  const ctx: PresetContext | null = legal
    ? { legal, street: p.street, pot: p.pot, currentBet: p.currentBet, bigBlind: p.bigBlind, preflopRaises: p.preflopRaises, limpers: p.limpers }
    : null;
  const presets = useMemo(() => (ctx ? presetsFor(ctx) : []), [p.decisionKey, !!legal]); // eslint-disable-line react-hooks/exhaustive-deps
  const [raiseTo, setRaiseTo] = useState(0);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // new decision → reset amount and unlock
  useEffect(() => {
    if (ctx && legal?.raiseType) {
      const d = defaultRaiseTo(ctx);
      setRaiseTo(d);
      setText(String(d));
    }
    setSubmitted(false);
  }, [p.decisionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = !!legal && !submitted;
  const parsed = Number(text);
  const textValid =
    !!legal?.raiseType && text.trim() !== '' && Number.isInteger(parsed) && parsed >= legal.minTo && parsed <= legal.maxTo;

  const send = (a: Action) => {
    if (!active) return;
    setSubmitted(true); // lock immediately: no double submits
    p.onAct(a);
  };
  const fold = () => legal?.canFold && send({ type: 'fold' });
  const checkCall = () => legal && send(legal.canCall ? { type: 'call' } : { type: 'check' });
  const raise = () => {
    if (!legal?.raiseType || !textValid) return;
    send({ type: legal.raiseType, amount: parsed });
  };
  const setAmount = (v: number) => {
    if (!legal?.raiseType) return;
    const c = clampTo(legal, v);
    setRaiseTo(c);
    setText(String(c));
  };

  // keyboard shortcuts
  const handlers = useRef({ fold, checkCall, raise, setAmount, raiseTo, active, legal, bb: p.bigBlind });
  handlers.current = { fold, checkCall, raise, setAmount, raiseTo, active, legal, bb: p.bigBlind };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlers.current;
      if (!h.active || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal:not(.modal--closing)')) return; // dialogs own the keyboard
      const target = e.target as HTMLElement | null;
      const type = target && target.tagName === 'INPUT' ? (target as HTMLInputElement).type : '';
      const inText = type === 'number';
      // only real text fields swallow shortcuts (checkboxes, sliders and buttons don't)
      if (type === 'text' || type === 'search' || type === 'email') return;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase();
      if (inText) {
        if (k === 'enter') {
          e.preventDefault();
          h.raise();
        }
        return;
      }
      if (k === 'f') {
        e.preventDefault();
        h.fold();
      } else if (k === 'c' || k === 'k') {
        e.preventDefault();
        h.checkCall();
      } else if (k === 'r' || k === 'b' || k === 'enter') {
        // Enter on any focused button activates that button natively (a preset applies its size; it never submits a different amount)
        if (target && target.tagName === 'BUTTON' && k === 'enter') return;
        e.preventDefault();
        h.raise();
      } else if (h.legal?.raiseType && (k === 'arrowup' || k === 'arrowright' || k === 'arrowdown' || k === 'arrowleft')) {
        e.preventDefault();
        const dir = k === 'arrowup' || k === 'arrowright' ? 1 : -1;
        h.setAmount(h.raiseTo + dir * stepFor(h.bb) * (e.shiftKey ? 5 : 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toCall = legal?.toCall ?? 0;
  const odds = legal ? potOdds(legal, p.totals, p.heroPi) : null;
  const need = odds?.need ?? 0;
  const raiseLabel = legal?.raiseType === 'bet' ? 'Bet' : 'Raise to';
  const allIn = legal && legal.raiseType && raiseTo === legal.maxTo;

  return (
    <div className={`actionbar ${active ? 'actionbar--active' : ''}`} data-testid="actionbar">
      <div className="actionbar__info" aria-live="polite">
        {active && legal ? (
          toCall > 0 ? (
            <>
              {p.timerText && <span className="actionbar__timer">{p.timerText}</span>}
              <span>
                To call <strong>{fmtChips(legal.callAmount)}</strong>
                {legal.callIsAllIn && ' (all-in)'}
              </span>
              <span className="dot">·</span>
              <span>
                {odds && odds.pot !== p.pot ? (
                  <span title="You can only win what you can match: chips above your stack go back to the bettor or into a side pot">
                    Pot you can win <strong>{fmtChips(odds.pot)}</strong>
                  </span>
                ) : (
                  <>
                    Pot <strong>{fmtChips(p.pot)}</strong>
                  </>
                )}
              </span>
              {p.showPotOdds !== false && (
                <>
                  <span className="dot">·</span>
                  <span title="Pot odds: the share of the final pot you pay to call. If your chance of winning is higher than this, calling makes money in the long run.">
                    Pot odds <strong>{((1 - need) / need).toFixed(1)} : 1</strong> — you need{' '}
                    <strong>{(need * 100).toFixed(1)}%</strong> equity to call
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span className="actionbar__yourturn">Your turn{p.timerText ? ` · ${p.timerText}` : ''}</span>
              <span className="dot">·</span>
              <span>
                Pot <strong>{fmtChips(p.pot)}</strong>
              </span>
              <span className="dot">·</span>
              <span>No bet to you — you can check for free</span>
            </>
          )
        ) : (
          <span className="actionbar__waiting">{p.waitingText}</span>
        )}
      </div>

      <div className="actionbar__row">
        <div className="actionbar__main">
          <button
            className="btn btn--fold"
            disabled={!active || !legal?.canFold}
            onClick={fold}
            data-testid="btn-fold"
            title="Fold (F)"
          >
            Fold
            <kbd>F</kbd>
          </button>
          <button className="btn btn--call" disabled={!active} onClick={checkCall} data-testid="btn-call" title="Check / Call (C)">
            {active && legal?.canCall ? (
              <>
                Call <span className="btn__amt">{fmtChips(legal.callAmount)}</span>
              </>
            ) : (
              'Check'
            )}
            <kbd>C</kbd>
          </button>
          <button
            className="btn btn--raise"
            disabled={!active || !legal?.raiseType || !textValid}
            onClick={raise}
            data-testid="btn-raise"
            title={`${raiseLabel} (R or Enter)`}
          >
            {!active || !legal?.raiseType || !textValid ? (legal?.raiseType === 'bet' ? 'Bet' : 'Raise') : allIn || legal?.raiseAllInOnly ? 'All-in' : raiseLabel}{' '}
            <span className="btn__amt">{active && legal?.raiseType && textValid ? fmtChips(parsed) : ''}</span>
            <kbd>R</kbd>
          </button>
        </div>

        <div className={`actionbar__sizing ${legal?.raiseType && active ? '' : 'actionbar__sizing--off'}`}>
          <div className="presets">
            {(presets.length && !legal?.raiseAllInOnly ? presets : legal?.raiseAllInOnly ? ALLIN_ONLY(legal.maxTo) : PLACEHOLDER_PRESETS).map((pr, i) => (
              <button
                key={i}
                className={`preset ${active && textValid && pr.to === parsed && (presets.length ? presets : PLACEHOLDER_PRESETS).find((x) => x.to === parsed) === pr ? 'preset--on' : ''}`}
                disabled={!active || pr.to < 0}
                onClick={() => setAmount(pr.to)}
                title={`${pr.hint}: ${fmtChips(pr.to)}`}
              >
                {pr.label}
              </button>
            ))}
          </div>
          <div className="sizer">
            <button className="sizer__step" disabled={!active} onClick={() => setAmount(raiseTo - p.bigBlind)} aria-label="Decrease by one big blind" title="Down / Left arrow">
              −
            </button>
            <input
              type="range"
              className="sizer__slider"
              min={legal?.minTo ?? 0}
              max={legal?.maxTo ?? 1}
              step={1}
              value={active ? raiseTo : (legal?.minTo ?? 0)}
              disabled={!active || !legal?.raiseType || legal.raiseAllInOnly}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Raise amount"
              title="Arrow keys: ±1 big blind (Shift: ±5)"
            />
            <button className="sizer__step" disabled={!active} onClick={() => setAmount(raiseTo + p.bigBlind)} aria-label="Increase by one big blind" title="Up / Right arrow">
              +
            </button>
            <label className={`sizer__input ${text !== '' && !textValid && active && legal?.raiseType ? 'sizer__input--bad' : ''}`}>
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min={legal?.minTo}
                max={legal?.maxTo}
                step={1}
                value={active && legal?.raiseType ? text : ''}
                disabled={!active || !legal?.raiseType}
                onChange={(e) => {
                  setText(e.target.value);
                  const v = Number(e.target.value);
                  if (legal?.raiseType && Number.isInteger(v) && v >= legal.minTo && v <= legal.maxTo) setRaiseTo(v);
                }}
                onBlur={() => {
                  // clamp anything typed to the legal range
                  if (text.trim() !== '' && !Number.isNaN(parsed)) setAmount(Math.round(parsed));
                  else setAmount(raiseTo);
                }}
                aria-label="Raise to amount"
                data-testid="raise-input"
              />
              <span className="sizer__bb">{legal?.raiseType && textValid ? fmtBB(parsed, p.bigBlind) : ''}</span>
            </label>
          </div>
          <div className="sizer__range">
            {legal?.raiseType && active ? (
              text !== '' && !textValid ? (
                <span className="sizer__err">
                  Enter a whole number from {fmtChips(legal.minTo)} to {fmtChips(legal.maxTo)}
                </span>
              ) : (
                <span>
                  {legal.raiseAllInOnly ? `You can only raise all-in (${fmtChips(legal.maxTo)})` : `Min ${fmtChips(legal.minTo)} · Max ${fmtChips(legal.maxTo)}`}
                </span>
              )
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
