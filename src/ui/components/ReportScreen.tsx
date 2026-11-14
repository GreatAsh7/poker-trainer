import { useMemo, useState } from 'react';
import type { MatchReport, StatRow, DecisionNote } from '../../analysis/coach';
import type { Card } from '../../engine/cards';
import { PlayingCard } from './PlayingCard';

interface Props {
  report: MatchReport;
  history: MatchReport[];
  /** replay is available only for hands of the match just played */
  canReplay: (handId: number) => boolean;
  onReplay: (handId: number) => void;
  /** undefined when there is no match to repeat (report opened from setup) */
  onPlayAgain?: () => void;
  onSettings: () => void;
}

const signed = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(digits)}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Cards({ cards, size = 'sm' }: { cards: Card[]; size?: 'sm' | 'md' }) {
  return (
    <span className="mini-cards">
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size={size} />
      ))}
    </span>
  );
}

const GRADE_TEXT: Record<string, string> = {
  '–': 'Not enough hands to grade — play at least 15',
  A: 'Excellent — very few costly decisions',
  B: 'Good — a few leaks to tidy up',
  C: 'Fair — some recurring mistakes',
  D: 'Needs work — several costly patterns',
  F: 'Tough match — focus on the basics below',
};

export function ReportScreen({ report: r, history, canReplay, onReplay, onPlayAgain, onSettings }: Props) {
  const [tab, setTab] = useState<'report' | 'hands' | 'progress'>('report');
  const bb = r.bigBlind;
  return (
    <div className="report" data-testid="report">
      <div className="report__inner">
        <header className="rcard report__hero">
          <div className={`grade grade--${r.grade === '–' ? 'none' : r.grade}`} aria-label={r.grade === '–' ? 'No grade' : `Grade ${r.grade}`}>
            {r.grade === '–' ? 'No grade' : r.grade}
          </div>
          <div className="report__headline">
            <p className="report__kicker">Match report · {new Date(r.date).toLocaleString()}</p>
            <h1>
              <span className={r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}>{signed(r.netBB)} BB</span>
              <span className="report__sub">
                {' '}
                over {r.hands} hand{r.hands === 1 ? '' : 's'}
                {r.hands >= 15 ? ` · ${signed(r.bb100)} BB/100` : ''}
              </span>
            </h1>
            <p className="report__grade-text">{GRADE_TEXT[r.grade]}</p>
            <p className="report__summary">{r.summary}</p>
          </div>
          <div className="report__actions">
            {onPlayAgain && (
              <button className="btn btn--primary" onClick={onPlayAgain} data-testid="play-again">
                Play again (same settings)
              </button>
            )}
            <button className={`btn ${onPlayAgain ? '' : 'btn--primary'}`} onClick={onSettings}>
              {onPlayAgain ? 'Change settings' : 'Back to setup'}
            </button>
          </div>
        </header>

        <nav className="report__tabs" role="tablist" aria-label="Report sections">
          {(
            [
              ['report', 'Coaching report'],
              ['hands', 'Hand-by-hand review'],
              ['progress', `Progress (${history.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              id={`tab-${k}`}
              role="tab"
              aria-selected={tab === k}
              aria-controls={`panel-${k}`}
              tabIndex={tab === k ? 0 : -1}
              className={`report__tab ${tab === k ? 'report__tab--on' : ''}`}
              onClick={() => setTab(k)}
              onKeyDown={(e) => {
                const keys = ['report', 'hands', 'progress'] as const;
                const i0 = keys.indexOf(k);
                const j =
                  e.key === 'ArrowRight' ? (i0 + 1) % keys.length : e.key === 'ArrowLeft' ? (i0 + keys.length - 1) % keys.length : e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : -1;
                if (j < 0) return;
                e.preventDefault();
                const n = keys[j];
                setTab(n);
                document.getElementById(`tab-${n}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'report' && (
          <div role="tabpanel" id="panel-report" aria-labelledby="tab-report" className="report__panel">
            <div className="report__grid">
              <section className="rcard">
                <h2>Your plan for next match</h2>
                <ol className="focus">
                  {r.focus.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ol>
              </section>
              <section className="rcard">
                <h2>Results</h2>
                <dl className="kv">
                  <div>
                    <dt>Net result</dt>
                    <dd className={r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}>
                      {signed(r.net, 0)} chips ({signed(r.netBB)} BB)
                    </dd>
                  </div>
                  <div>
                    <dt>Win rate</dt>
                    <dd>{r.hands >= 15 ? `${signed(r.bb100)} BB per 100 hands` : 'too few hands to measure'}</dd>
                  </div>
                  <div>
                    <dt>Costly decisions</dt>
                    <dd>
                      {r.mistakesCount}{' '}
                      {r.hands >= 15 ? `(≈ ${r.evLossBB100.toFixed(1)} BB per 100 hands)` : `(≈ ${((r.evLossBB100 * r.hands) / 100).toFixed(1)} BB in total)`}
                    </dd>
                  </div>
                  {r.allIn.count > 0 && (
                    <div>
                      <dt title="Your expected result in all-in hands, based on your equity when the money went in, versus what actually happened">All-in luck</dt>
                      <dd>
                        {r.allIn.count} all-in{r.allIn.count > 1 ? 's' : ''}: expected {signed(r.allIn.evNet / bb)} BB, got {signed(r.allIn.actualNet / bb)} BB →{' '}
                        {Math.abs(r.allIn.luck) < bb / 2 ? (
                          <strong>right on expectation</strong>
                        ) : (
                          <strong className={r.allIn.luck >= 0 ? 'pos' : 'neg'}>
                            {r.allIn.luck >= 0 ? 'ran good' : 'ran bad'} by {Math.abs(r.allIn.luck / bb).toFixed(1)} BB
                          </strong>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="pots">
                  <PotList title="Biggest pots won" items={r.biggestWon} bb={bb} />
                  <PotList title="Biggest pots lost" items={r.biggestLost} bb={bb} />
                </div>
              </section>
            </div>

            <section className="rcard">
              <h2>Key hands</h2>
              {r.keyHands.length === 0 && (
                <p className="muted">
                  {r.hands < 15
                    ? `Only ${r.hands} hand${r.hands === 1 ? '' : 's'} — too few for key hands.`
                    : r.net < 0
                      ? 'No costly decisions were found: the losses came from the cards, not the choices.'
                      : 'No costly decisions were found this match. Nice work.'}
                </p>
              )}
              <div className="keyhands">
                {r.keyHands.map((k) => (
                  <article key={k.handId} className="keyhand">
                    <div className="keyhand__top">
                      <div className="keyhand__cards">
                        <Cards cards={k.hole} size="md" />
                        {k.board.length > 0 && <Cards cards={k.board} />}
                      </div>
                      <div className="keyhand__title">
                        <h3>
                          Hand {k.handId}: {k.title}
                        </h3>
                        <span className="keyhand__meta">
                          {k.position} · result {signed(k.net / bb)} BB
                        </span>
                      </div>
                      <span className="cost" title="Estimated average cost of the decision(s) compared with the best option">
                        −{k.evLossBB.toFixed(1)} BB
                      </span>
                    </div>
                    <p className="keyhand__situation">{k.situation}</p>
                    <div className="keyhand__compare">
                      <p>
                        <span className="tag tag--you">You</span> {k.did}
                      </p>
                      <p>
                        <span className="tag tag--pro">Better</span> {k.better}
                      </p>
                    </div>
                    {k.why.map((w, i) => (
                      <p key={i} className="keyhand__why">
                        {w}
                      </p>
                    ))}
                    {canReplay(k.handId) && (
                      <button className="btn-ghost" onClick={() => onReplay(k.handId)}>
                        ⟲ Replay hand {k.handId}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>

            <div className="report__grid">
              <section className="rcard">
                <h2>What you did well</h2>
                {r.wellPlayed.length === 0 && <p className="muted">Not enough clear-cut good decisions to highlight this time.</p>}
                <ul className="tips">
                  {r.wellPlayed.map((t, i) => (
                    <li key={i}>
                      <strong>{t.title}</strong>
                      <p>{t.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="rcard">
                <h2>Strategies you could have used</h2>
                {r.strategies.length === 0 && <p className="muted">No clear exploits stood out in this sample.</p>}
                <ul className="tips">
                  {r.strategies.map((t, i) => (
                    <li key={i}>
                      <strong>{t.title}</strong>
                      <p>{t.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="rcard">
              <h2>Your stats vs a solid player</h2>
              <div className="stats">
                {r.stats.map((s) => (
                  <StatLine key={s.key} s={s} />
                ))}
              </div>
              {r.byPosition.length > 0 && (
                <table className="postable">
                  <caption>By position</caption>
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Hands</th>
                      <th>VPIP</th>
                      <th>PFR</th>
                      <th>Typical open (solid player)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byPosition.map((p) => (
                      <tr key={p.pos}>
                        <td>{p.pos}</td>
                        <td>{p.hands}{p.hands < 5 && <span className="muted"> (small)</span>}</td>
                        <td className={p.hands < 5 ? 'muted' : ''}>{pct(p.vpip)}</td>
                        <td className={p.hands < 5 ? 'muted' : ''}>{pct(p.pfr)}</td>
                        <td className="muted">{p.refOpen}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}

        {tab === 'hands' && (
          <div role="tabpanel" id="panel-hands" aria-labelledby="tab-hands">
            <HandReview report={r} canReplay={canReplay} onReplay={onReplay} />
          </div>
        )}
        {tab === 'progress' && (
          <div role="tabpanel" id="panel-progress" aria-labelledby="tab-progress">
            <Progress history={history} current={r.id} />
          </div>
        )}
      </div>
    </div>
  );
}

function PotList({ title, items, bb }: { title: string; items: MatchReport['biggestWon']; bb: number }) {
  return (
    <div>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">—</p>
      ) : (
        <ul className="potlist">
          {items.map((x) => (
            <li key={x.handId}>
              <Cards cards={x.hole} />
              <span>Hand {x.handId}</span>
              <strong className={x.net > 0 ? 'pos' : 'neg'}>{signed(x.net / bb)} BB</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatLine({ s }: { s: StatRow }) {
  const max = s.unit === 'pct' ? Math.max(1, s.ref[1] * 1.6) : Math.max(6, s.ref[1] * 1.6);
  const pos = (x: number) => `${Math.min(100, Math.max(0, (x / max) * 100))}%`;
  const fmt = (x: number) => (s.unit === 'pct' ? pct(x) : isFinite(x) ? x.toFixed(1) : '∞');
  const has = s.verdict !== 'sample' && !isNaN(s.value);
  return (
    <div className="stat">
      <div className="stat__head">
        <span className="stat__label">{s.label}</span>
        <span className={`pill pill--${s.verdict}`}>
          {s.verdict === 'sample' ? 'small sample' : s.verdict === 'ok' ? 'on target' : s.verdict === 'low' ? 'too low' : 'too high'}
        </span>
        <span className="stat__value">{has ? fmt(s.value) : '—'}</span>
      </div>
      <div className="bar" aria-hidden>
        <span className="bar__band" style={{ left: pos(s.ref[0]), width: `calc(${pos(s.ref[1])} - ${pos(s.ref[0])})` }} />
        {has && <span className={`bar__mark bar__mark--${s.verdict}`} style={{ left: pos(s.value) }} />}
      </div>
      <p className="stat__text">{s.text}</p>
    </div>
  );
}

function HandReview({ report, canReplay, onReplay }: { report: MatchReport; canReplay: (id: number) => boolean; onReplay: (id: number) => void }) {
  const ids = Object.keys(report.decisions).map(Number).sort((a, b) => a - b);
  const [only, setOnly] = useState(true);
  const shown = ids.filter((id) => !only || report.decisions[id].some((d) => d.kind));
  if (!ids.length) return <section className="rcard"><p className="muted">Detailed decisions are kept only for your most recent matches.</p></section>;
  return (
    <section className="rcard">
      <div className="review__head">
        <h2>Hand-by-hand review</h2>
        <label className="chk">
          <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only hands with notes
        </label>
      </div>
      {shown.length === 0 && <p className="muted">No hands with notes.</p>}
      {shown.map((id) => (
        <div key={id} className="review__hand">
          <div className="review__hand-head">
            <strong>Hand {id}</strong>
            {report.decisions[id][0] && <Cards cards={report.decisions[id][0].hole} />}
            {canReplay(id) && (
              <button className="btn-ghost" onClick={() => onReplay(id)}>
                ⟲ Replay
              </button>
            )}
          </div>
          <DecisionList notes={report.decisions[id]} bigBlind={report.bigBlind} />
        </div>
      ))}
    </section>
  );
}

export function DecisionList({ notes, bigBlind = 2 }: { notes: DecisionNote[]; bigBlind?: number }) {
  return (
    <ul className="decisions">
      {notes.map((d, i) => (
        <li key={i} className={`decision ${d.kind ? (d.kind.startsWith('good') ? 'decision--good' : 'decision--bad') : ''}`}>
          <div className="decision__row">
            <span className="decision__street">{d.street}</span>
            {d.board.length > 0 && <Cards cards={d.board} />}
            <span className="decision__act">
              You: <strong>{d.heroLabel}</strong>
            </span>
            <span className="decision__nums">
              {d.toCall > 0 ? `need ${pct(d.need)} · ` : ''}equity {pct(d.equity)}
              {d.villainName ? ` vs ${d.villainName}` : ''}
            </span>
            {d.kind && !d.kind.startsWith('good') ? (
              <span className="cost">−{(d.evLoss / bigBlind).toFixed(1)} BB</span>
            ) : d.kind ? (
              <span className="pill pill--ok">good</span>
            ) : null}
          </div>
          {d.text && <p className="decision__text">{d.text}</p>}
          {!d.text && d.bestLabel && d.evLoss / bigBlind < 1.5 && d.heroLabel.split(' ')[0] !== d.bestLabel.split(' ')[0].toLowerCase() && d.street !== 'preflop' && (
            <p className="decision__text muted">Close decision: {d.bestLabel.toLowerCase()} rated slightly higher, but the difference was small.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Progress({ history, current }: { history: MatchReport[]; current: string }) {
  const pts = useMemo(() => history.slice(-15), [history]);
  if (pts.length < 2)
    return (
      <section className="rcard">
        <h2>Progress</h2>
        <p className="muted">Play another match to see your progress over time. Reports are saved in this browser.</p>
      </section>
    );
  const W = 640;
  const H = 180;
  const loss = pts.map((p) => p.evLossBB100);
  const maxL = Math.max(10, ...loss);
  const x = (i: number) => 30 + (i * (W - 60)) / (pts.length - 1);
  const y = (v: number) => 20 + (1 - v / maxL) * (H - 50);
  return (
    <section className="rcard">
      <h2>Progress</h2>
      <p className="muted">Costly decisions per 100 hands (lower is better), with each match's grade and length, for your last {pts.length} matches.</p>
      <svg className="progress" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Costly decisions per 100 hands over recent matches">
        <text x={W - 4} y="12" textAnchor="end" className="progress__axis">BB lost per 100 hands</text>
        <text x="4" y={y(0) + 4} className="progress__axis">0</text>
        <text x="4" y={y(maxL) + 14} className="progress__axis">{maxL.toFixed(0)}</text>
        <polyline fill="none" stroke="var(--gold)" strokeWidth="2.5" points={loss.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        {pts.map((p, i) => (
          <g key={p.id}>
            <circle
              cx={x(i)}
              cy={y(loss[i])}
              r={p.id === current ? 6 : 4}
              fill={p.hands < 15 ? 'var(--panel)' : p.id === current ? 'var(--gold-2)' : 'var(--gold)'}
              stroke="var(--gold)"
              strokeWidth={2}
            >
              <title>{p.hands < 15 ? 'Short match: less reliable' : `${p.hands} hands`}</title>
            </circle>
            <text x={x(i)} y={H - 8} textAnchor="middle" className="progress__grade">
              {p.grade} · {p.hands}h
            </text>
            <text x={x(i)} y={y(loss[i]) - 10} textAnchor="middle" className="progress__val">
              {loss[i].toFixed(0)}
            </text>
          </g>
        ))}
      </svg>
      <table className="postable">
        <thead>
          <tr>
            <th>Date</th>
            <th>Hands</th>
            <th>Result</th>
            <th>BB/100</th>
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          {[...pts].reverse().map((p) => (
            <tr key={p.id} className={p.id === current ? 'is-current' : ''}>
              <td>{new Date(p.date).toLocaleDateString()}</td>
              <td>{p.hands}</td>
              <td className={p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : ''}>{signed(p.netBB)} BB</td>
              <td>{p.hands >= 15 ? signed(p.bb100) : '—'}</td>
              <td>{p.grade}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
