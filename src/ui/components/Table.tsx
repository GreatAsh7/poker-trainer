import { memo, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { TableDisplay, SeatDisplay } from '../display';
import { BOARD_PT, DEALER_PT, POT_PT, STAGE_H, STAGE_W, slotFor, type Pt } from '../layout';
import { PlayingCard } from './PlayingCard';
import { ChipStack } from './Chips';
import { fmtBB, fmtChips } from '../format';
import { bestFive } from '../../engine/evaluator';
import { STREETS } from '../../engine/game';

export interface SeatHud {
  style: string;
  vpip: string;
  pfr: string;
  hands: number;
}

interface TableProps {
  display: TableDisplay;
  heroPi: number;
  tableSize: number;
  thinkingPi: number;
  thinkStart: number;
  thinkDuration: number;
  hud: Record<string, SeatHud> | null;
  bigBlind: number;
  /** overlay content in the middle of the felt (e.g. "Hand over" banner) */
  center?: ReactNode;
}

/** Scales a fixed-size stage to fit its parent without changing layout (no reflow, no shift). */
export function Stage({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.3, Math.min(r.width / STAGE_W, r.height / STAGE_H)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="stage-outer" ref={outer}>
      <div className="stage" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

const at = (p: Pt) => ({ left: p.x, top: p.y });

export const Table = memo(function Table(props: TableProps) {
  const { display: d, heroPi, tableSize, thinkingPi, hud, bigBlind } = props;
  const streetIdx = STREETS.indexOf(d.street);
  const winnersShown = d.awards.length > 0;
  const heroSeat = d.seats[heroPi];
  // highlight the winning five cards at showdown
  let winCards: number[] = [];
  if (winnersShown && d.board.length === 5) {
    const w = d.seats.find((s) => s.winner && s.cards && s.cards.length === 2);
    if (w && w.cards) winCards = bestFive([...w.cards, ...d.board]);
  }
  const np = d.seats.length;
  return (
    <div className="table" data-testid="table">
      <div className="table__rail" />
      <div className="table__felt">
        <div className="table__logo">POKER TRAINER</div>
      </div>

      {/* pot */}
      <div className="pot" style={at(POT_PT)} data-testid="pot">
        <AnimatePresence>
          {d.totalPot > 0 && (
            <motion.div
              key={`pot-${d.handId}`}
              className="pot__inner"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="pot__total">
                Pot <strong>{fmtChips(d.totalPot)}</strong>
                <span className="pot__bb">{fmtBB(d.totalPot, bigBlind)}</span>
              </div>
              {d.pot > 0 && <ChipStack amount={d.pot} showLabel={false} />}
              {d.pots.length > 1 && (
                <div className="pot__sides">
                  {d.pots.map((p) => (
                    <span key={p.label}>
                      {p.label}: {fmtChips(p.amount)}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* board */}
      <div className="board" style={at(BOARD_PT)} data-testid="board">
        {[0, 1, 2, 3, 4].map((i) => {
          const c = d.board[i];
          const flopIdx = i < 3 ? i : 0;
          return (
            <div className="board__slot" key={i}>
              <AnimatePresence>
                {c !== undefined && (
                  <motion.div
                    key={`${d.handId}-${i}`}
                    initial={{ opacity: 0, y: -40, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.25 } }}
                    transition={{ duration: 0.25, delay: flopIdx * 0.09 }}
                  >
                    <PlayingCard
                      card={c}
                      size="lg"
                      flipDelay={0.18 + flopIdx * 0.12}
                      dim={winnersShown && winCards.length > 0 && !winCards.includes(c)}
                      highlight={winCards.includes(c)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* bets in front of players: they slide in from the seat and sweep into the pot */}
      <AnimatePresence>
        {d.seats.map((s) => {
          if (s.bet <= 0) return null;
          const slot = slotFor(s.seat, tableSize);
          return (
            <motion.div
              key={`bet-${d.handId}-${streetIdx}-${s.pi}`}
              className="bet"
              style={at(slot.bet)}
              initial={{ x: slot.seat.x - slot.bet.x, y: slot.seat.y - slot.bet.y, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              exit={{ x: POT_PT.x - slot.bet.x, y: POT_PT.y - slot.bet.y, opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.25, 0.8, 0.3, 1] }}
            >
              <div className="bet__center">
                <ChipStack amount={s.bet} />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* chips pushed from the pot to the winners */}
      {d.awards.map((a, k) =>
        a.winners.map((w, j) => {
          const slot = slotFor(d.seats[w].seat, tableSize);
          return (
            <motion.div
              key={`award-${d.handId}-${k}-${w}`}
              className="bet bet--award"
              style={at(POT_PT)}
              initial={{ x: 0, y: 0, opacity: 1 }}
              animate={{ x: slot.seat.x - POT_PT.x, y: slot.seat.y - POT_PT.y, opacity: [1, 1, 0] }}
              transition={{ duration: 0.75, ease: [0.3, 0.7, 0.3, 1], times: [0, 0.8, 1] }}
            >
              <div className="bet__center">
                <ChipStack amount={a.shares[j]} showLabel={false} />
              </div>
            </motion.div>
          );
        }),
      )}

      {/* dealer button */}
      {d.seats.map((s) =>
        s.isButton ? (
          <motion.div
            key="dealer-button"
            layoutId="dealer-button"
            className="dealer-btn"
            style={at(slotFor(s.seat, tableSize).button)}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            aria-label="Dealer button"
          >
            D
          </motion.div>
        ) : null,
      )}

      {d.seats.map((s) => (
        <SeatView
          key={s.seat}
          s={s}
          hero={s.pi === heroPi}
          handId={d.handId}
          tableSize={tableSize}
          dealIndex={(s.pi - d.seats.findIndex((x) => x.isButton) - 1 + np) % np}
          np={np}
          active={d.toAct === s.pi}
          thinking={thinkingPi === s.pi}
          thinkStart={props.thinkStart}
          thinkDuration={props.thinkDuration}
          hud={hud?.[s.id] ?? null}
          bigBlind={bigBlind}
          showdown={winnersShown}
          handOver={d.finished}
        />
      ))}

      {heroSeat && props.center && <div className="table__center">{props.center}</div>}
    </div>
  );
});

interface SeatProps {
  s: SeatDisplay;
  hero: boolean;
  handId: number;
  tableSize: number;
  dealIndex: number;
  np: number;
  active: boolean;
  thinking: boolean;
  thinkStart: number;
  thinkDuration: number;
  hud: SeatHud | null;
  bigBlind: number;
  showdown: boolean;
  handOver: boolean;
}

const SeatView = memo(function SeatView(p: SeatProps) {
  const { s, hero, tableSize } = p;
  const slot = slotFor(s.seat, tableSize);
  const cls = [
    'seat',
    hero ? 'seat--hero' : '',
    s.folded ? 'seat--folded' : '',
    p.active || p.thinking ? 'seat--active' : '',
    s.winner ? 'seat--winner' : '',
    s.allIn ? 'seat--allin' : '',
  ].join(' ');
  const showCards = s.hasCards || (s.cards && s.cards.length > 0 && !s.folded);
  const labelSide = !hero && slot.seat.x > 700 ? 'left' : 'right';
  const showHandName = !!s.handName && p.showdown && !s.mucked;
  const dx = DEALER_PT.x - slot.seat.x;
  const dy = DEALER_PT.y - slot.seat.y;
  return (
    <div className={cls} style={at(slot.seat)} data-testid={`seat-${s.seat}`} aria-label={`${hero ? 'You' : s.name}`}>
      <div className={`seat__cards ${hero ? 'seat__cards--hero' : ''}`}>
        <AnimatePresence>
          {showCards &&
            [0, 1].map((i) => (
              <motion.div
                key={`${p.handId}-${i}`}
                className="seat__card"
                initial={{ x: dx, y: dy, opacity: 0, rotate: -20 }}
                animate={{ x: 0, y: 0, opacity: s.mucked && !hero ? 0.35 : 1, rotate: i === 0 ? -4 : 4 }}
                exit={{ x: dx * 0.6, y: dy * 0.6, opacity: 0, rotate: 0, transition: { duration: 0.35 } }}
                transition={{ duration: 0.3, delay: (i * p.np + p.dealIndex) * 0.06, ease: [0.25, 0.8, 0.3, 1] }}
              >
                <PlayingCard
                  card={s.cards ? s.cards[i] : null}
                  faceUp={!!s.cards}
                  size={hero ? 'lg' : 'md'}
                  flipDelay={hero ? 0.35 + (i * p.np + p.dealIndex) * 0.06 : 0}
                />
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      <div className="seat__plate">
        {p.thinking && <TimerRing key={p.thinkStart} duration={p.thinkDuration} />}
        <div className="seat__avatar" aria-hidden>
          {hero ? 'You'.slice(0, 1) : s.name.slice(0, 1)}
        </div>
        <div className="seat__info">
          <div className="seat__name">{hero ? 'You' : s.name}</div>
          <div className="seat__stack">
            {s.stack > 0 || !s.allIn || p.handOver ? (
              <>
                <span className="seat__chips">{fmtChips(s.stack)}</span>
                <span className="seat__bb">{fmtBB(s.stack, p.bigBlind)}</span>
              </>
            ) : (
              <span className="seat__chips seat__chips--allin">ALL-IN</span>
            )}
          </div>
        </div>
      </div>

      {p.hud && !hero && !showHandName && (
        <div className="seat__hud" title={`Over ${p.hud.hands} hands: VPIP = how often they put money in preflop; PFR = how often they raise preflop`}>
          <span className="seat__hud-style">{p.hud.style}</span>
          <span>
            VPIP {p.hud.vpip} · PFR {p.hud.pfr}
          </span>
        </div>
      )}

      <div className={`seat__label-wrap seat__label-wrap--${labelSide}`}>
      <AnimatePresence>
        {s.label && (
          <motion.div
            key={`${p.handId}`}
            className={`seat__label seat__label--${s.labelKind}`}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.18 }}
          >
            {s.label}
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {showHandName && <div className={`seat__handname ${s.winner ? 'seat__handname--win' : ''}`}>{s.handName}</div>}
    </div>
  );
});

function TimerRing({ duration }: { duration: number }) {
  return (
    <svg className="timer-ring" viewBox="0 0 100 100" aria-hidden>
      <rect className="timer-ring__track" x="2" y="2" width="96" height="96" rx="18" pathLength={100} />
      <rect
        className="timer-ring__bar"
        x="2"
        y="2"
        width="96"
        height="96"
        rx="18"
        pathLength={100}
        style={{ animationDuration: `${duration}ms` }}
      />
    </svg>
  );
}
