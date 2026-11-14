import { useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import type { HandState } from '../../engine/game';
import { deriveDisplay, describeEvent } from '../display';
import { Stage, Table } from './Table';
import { Modal } from './Modal';
import { DecisionList } from './ReportScreen';
import type { DecisionNote } from '../../analysis/coach';

interface Props {
  hand: HandState;
  heroPi: number;
  tableSize: number;
  bigBlind: number;
  onClose: () => void;
  /** coach's notes for this hand (computed in the worker) */
  loadNotes?: () => Promise<DecisionNote[]>;
}

/** Step-by-step replay of a finished hand (public information only). */
export function ReplayModal({ hand, heroPi, tableSize, bigBlind, onClose, loadNotes }: Props) {
  const [notes, setNotes] = useState<DecisionNote[] | null>(null);
  const [notesErr, setNotesErr] = useState(false);
  useEffect(() => {
    if (!loadNotes) return;
    let live = true;
    loadNotes()
      .then((n) => live && setNotes(n))
      .catch(() => live && setNotesErr(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.handId]);
  // steps = indexes of events that change what is visible
  const steps = useMemo(() => {
    const out: number[] = [];
    hand.events.forEach((e, i) => {
      if (e.kind !== 'end') out.push(i + 1);
    });
    return out;
  }, [hand]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    if (step >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 900);
    return () => clearTimeout(t);
  }, [playing, step, steps.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal--closing')) return; // closing: keys go back to the table
      const t = e.target as HTMLElement | null;
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, steps.length - 1));
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
      else if (e.key === ' ' && t?.tagName === 'BUTTON') return; // let Space press the focused button
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [steps.length]);
  const k = steps[step] ?? 0;
  const display = deriveDisplay(hand, k, heroPi);
  const lines: string[] = [];
  for (let i = 0; i < k; i++) {
    const e = hand.events[i];
    const t = e.kind === 'street' ? `— ${e.street[0].toUpperCase()}${e.street.slice(1)} —` : describeEvent(hand, i, heroPi);
    if (t) lines.push(t);
  }
  return (
    <Modal title={`Replay · Hand ${hand.handId}`} onClose={onClose} wide>
      <div className={`replay ${loadNotes && heroPi >= 0 ? 'replay--notes' : ''}`}>
        <div className="replay__main">
        <div className="replay__table">
          <MotionConfig reducedMotion="user">
            <Stage>
              <Table
                display={display}
                heroPi={heroPi}
                tableSize={tableSize}
                thinkingPi={-1}
                thinkStart={0}
                thinkDuration={0}
                hud={null}
                bigBlind={bigBlind}
              />
            </Stage>
          </MotionConfig>
        </div>
        <div className="replay__controls">
          <button className="icon-btn" onClick={() => { setPlaying(false); setStep(0); }} aria-label="First step">⏮</button>
          <button className="icon-btn" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} aria-label="Previous step">◀</button>
          <button className="btn btn--small" onClick={() => {
            if (step >= steps.length - 1) setStep(0);
            setPlaying((p) => !p);
          }}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="icon-btn" onClick={() => { setPlaying(false); setStep((s) => Math.min(steps.length - 1, s + 1)); }} aria-label="Next step">▶</button>
          <button className="icon-btn" onClick={() => { setPlaying(false); setStep(steps.length - 1); }} aria-label="Last step">⏭</button>
          <span className="replay__last">{lines[lines.length - 1] ?? 'Blinds posted'}</span>
          <span className="replay__count">{step + 1} / {steps.length}</span>
        </div>
        </div>
        {loadNotes && heroPi >= 0 && (
          <div className="replay__notes">
            <h3>Coach's notes</h3>
            {notesErr ? (
              <p className="neg">Could not analyse this hand.</p>
            ) : !notes ? (
              <p className="building">
                <span className="spinner" aria-hidden /> Analysing your decisions…
              </p>
            ) : notes.length === 0 ? (
              <p className="muted">You had no decisions to make in this hand.</p>
            ) : (
              <DecisionList notes={notes} bigBlind={bigBlind} />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
