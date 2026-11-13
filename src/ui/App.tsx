import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { TableController, createDecideFn, positionName, type MatchSetup } from './controller';
import { BotClient } from './botClient';
import { Stage, Table, type SeatHud } from './components/Table';
import { ActionBar } from './components/ActionBar';
import { HandLog } from './components/HandLog';
import { ReplayModal } from './components/ReplayModal';
import { SetupScreen } from './components/SetupScreen';
import { Modal } from './components/Modal';
import { hudStats, pct } from '../analysis/hud';
import { fmtBB, fmtSigned } from './format';
import type { Action } from '../engine/game';

const STYLE_LABELS: Record<string, string> = {
  placeholder: 'Basic',
  tag: 'Solid (TAG)',
  lag: 'Aggressive (LAG)',
  nit: 'Tight-passive',
  station: 'Calling station',
  expert: 'Expert',
};

function useController() {
  const [ctrl] = useState(() => new TableController(createDecideFn(new BotClient())));
  const snap = useSyncExternalStore(ctrl.subscribe, ctrl.getSnapshot);
  useEffect(() => () => ctrl.stop(), [ctrl]);
  return [ctrl, snap] as const;
}

export function App() {
  const [ctrl, snap] = useController();
  const [screen, setScreen] = useState<'setup' | 'table'>('setup');
  const [lastSetup, setLastSetup] = useState<MatchSetup | null>(null);
  const [showLog, setShowLog] = useState(() => window.innerWidth >= 1200);
  const [showHud, setShowHud] = useState(true);
  const [fast, setFast] = useState(false);
  const [replayId, setReplayId] = useState<number | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const start = (s: MatchSetup) => {
    setLastSetup(s);
    ctrl.settings.pace = fast ? 0.5 : 1;
    ctrl.startMatch(s);
    setScreen('table');
  };

  useEffect(() => {
    ctrl.settings.pace = fast ? 0.5 : 1;
    ctrl.settings.thinkMin = fast ? 300 : 600;
    ctrl.settings.thinkMax = fast ? 800 : 1800;
  }, [fast, ctrl]);

  const modalOpen = replayId !== null || confirmLeave;
  useEffect(() => {
    ctrl.setPaused(modalOpen);
  }, [modalOpen, ctrl]);

  const onAct = useCallback((a: Action) => ctrl.act(a), [ctrl]);

  // global shortcuts that are not part of the action bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (document.querySelector('.modal')) return;
      if (e.key === ' ' && screen === 'table') {
        e.preventDefault();
        ctrl.skip();
      } else if (e.key.toLowerCase() === 'l' && screen === 'table') setShowLog((v) => !v);
      else if (e.key.toLowerCase() === 'h' && screen === 'table') setShowHud((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl, screen]);

  const hud = useMemo(() => {
    if (!showHud) return null;
    const st = hudStats(snap.history);
    const out: Record<string, SeatHud> = {};
    for (const b of snap.bots) {
      const s = st[b.id] ?? { hands: 0, vpip: 0, pfr: 0 };
      out[b.id] = { style: STYLE_LABELS[b.style] ?? b.style, vpip: pct(s.vpip, s.hands), pfr: pct(s.pfr, s.hands), hands: s.hands };
    }
    return out;
  }, [snap.history, snap.bots, showHud]);

  const finishedIds = useMemo(() => new Set(snap.history.map((h) => h.handId)), [snap.history]);

  if (screen === 'setup') {
    return (
      <MotionConfig reducedMotion="user">
        <SetupScreen onStart={start} initial={lastSetup ?? undefined} />
      </MotionConfig>
    );
  }

  const d = snap.display;
  const h = snap.hand;
  const bb = snap.match?.config.bigBlind ?? 2;
  const tableSize = snap.match?.seats.length ?? 6;
  const userSeat = snap.match?.seats[0];
  const net = userSeat ? userSeat.stack - userSeat.buyIns : 0;
  const heroDisplay = d && snap.userPi >= 0 ? d.seats[snap.userPi] : null;
  const thinkingName = snap.thinkingPi >= 0 && h ? h.players[snap.thinkingPi].name : null;
  let waiting = '';
  const nextActor = h && !h.finished && h.toAct >= 0 && h.toAct !== snap.userPi ? h.players[h.toAct].name : null;
  if (thinkingName) waiting = `${thinkingName} is thinking…  (Space to skip)`;
  else if (nextActor) waiting = `${nextActor} to act`;
  else if (snap.phase === 'handOver') waiting = 'Hand over — next hand coming up';
  if (heroDisplay?.folded && snap.phase === 'playing') waiting = `You folded — watching the rest of the hand${thinkingName ? ` · ${thinkingName} is thinking…` : ''}`;
  const preActs = h ? h.actions.filter((a) => a.street === 'preflop') : [];
  const preflopRaises = preActs.filter((a) => a.type === 'raise' || a.type === 'bet').length;
  const firstRaise = preActs.findIndex((a) => a.type === 'raise' || a.type === 'bet');
  const limpers = preActs.filter((a, i) => a.type === 'call' && (firstRaise < 0 || i < firstRaise)).length;
  const totals = h ? h.players.map((p) => p.totalBet) : [];
  const replayHand = replayId !== null ? snap.history.find((x) => x.handId === replayId) : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <div className={`app ${showLog ? '' : 'app--nolog'}`}>
        <header className="topbar">
          <div className="topbar__brand">♠ Poker Trainer</div>
          <div className="topbar__meta">
            <span>
              Hand <strong data-testid="hand-number">{Math.max(1, snap.handNumber)}</strong> / {snap.handsTotal}
            </span>
            <span>Blinds 1/2</span>
            {h && snap.userPi >= 0 && <span>You: {positionName(h, snap.userPi)}</span>}
            <span className={net > 0 ? 'pos' : net < 0 ? 'neg' : ''}>
              Session {fmtSigned(net)} ({fmtBB(net, bb).replace('-', '−')})
            </span>
          </div>
          <div className="topbar__actions">
            <label className="chk" title="Show each bot's style and stats (H)">
              <input type="checkbox" checked={showHud} onChange={(e) => setShowHud(e.target.checked)} /> HUD
            </label>
            <label className="chk" title="Faster animations and bot decisions">
              <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> Fast
            </label>
            <button className="btn-ghost" onClick={() => setShowLog((v) => !v)} title="Show or hide the hand log (L)">
              {showLog ? 'Hide log' : 'Show log'}
            </button>
            <button className="btn-ghost" onClick={() => setConfirmLeave(true)}>
              Leave match
            </button>
          </div>
        </header>

        <main className="main" onClick={(e) => {
          if ((e.target as HTMLElement).closest('.table')) ctrl.skip();
        }}>
          {d && (
            <Stage>
              <Table
                display={d}
                heroPi={snap.userPi}
                tableSize={tableSize}
                thinkingPi={snap.thinkingPi}
                thinkStart={snap.thinkStart}
                thinkDuration={snap.thinkDuration}
                hud={hud}
                bigBlind={bb}
              />
            </Stage>
          )}
          {snap.error && <div className="error-banner">Something went wrong: {snap.error}</div>}
        </main>

        {showLog && (
          <HandLog
            logs={snap.logs}
            currentHandId={snap.phase === 'playing' ? (h?.handId ?? -1) : -1}
            finished={finishedIds}
            onReplay={setReplayId}
            onClose={() => setShowLog(false)}
          />
        )}

        <footer className="footer">
          <ActionBar
            legal={snap.legal}
            street={d?.street ?? 'preflop'}
            pot={d?.totalPot ?? 0}
            currentBet={h?.currentBet ?? 0}
            bigBlind={bb}
            preflopRaises={preflopRaises}
            limpers={limpers}
            totals={totals}
            heroPi={snap.userPi}
            waitingText={waiting}
            onAct={onAct}
            decisionKey={`${h?.handId ?? 0}-${h?.actions.length ?? 0}-${snap.legal ? 1 : 0}`}
          />
        </footer>
      </div>

      <AnimatePresence>
        {replayHand && (
          <ReplayModal
            key={replayHand.handId}
            hand={replayHand}
            heroPi={replayHand.players.findIndex((p) => p.id === 'you')}
            tableSize={tableSize}
            bigBlind={bb}
            onClose={() => setReplayId(null)}
          />
        )}
        {snap.phase === 'matchOver' && (
          <Modal key="over" title="Match over">
            <div className="matchover">
              <p className="matchover__result">
                {userSeat && userSeat.busted ? 'You went broke. ' : `You played ${snap.match?.handsPlayed ?? 0} hands. `}
                Result: <strong className={net > 0 ? 'pos' : net < 0 ? 'neg' : ''}>{fmtSigned(net)} chips</strong> (
                {fmtBB(net, bb)})
              </p>
              <p className="muted">The full coaching report arrives in a later milestone.</p>
              <div className="matchover__actions">
                <button className="btn btn--primary" onClick={() => lastSetup && start({ ...lastSetup, seed: (Date.now() >>> 0) })}>
                  Play again
                </button>
                <button className="btn" onClick={() => { ctrl.stop(); setScreen('setup'); }}>
                  Change settings
                </button>
              </div>
            </div>
          </Modal>
        )}
        {confirmLeave && (
          <Modal key="leave" title="Leave this match?" onClose={() => setConfirmLeave(false)}>
            <p>Your progress in this match will be lost.</p>
            <div className="matchover__actions">
              <button className="btn btn--fold" onClick={() => { ctrl.stop(); setConfirmLeave(false); setScreen('setup'); }}>
                Leave match
              </button>
              <button className="btn" onClick={() => setConfirmLeave(false)} autoFocus>
                Keep playing
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
