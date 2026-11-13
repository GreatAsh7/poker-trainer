import { useEffect, useRef, useState } from 'react';
import type { HandLog as HandLogT } from '../controller';

interface Props {
  logs: HandLogT[];
  currentHandId: number;
  onReplay: (handId: number) => void;
  /** hand ids that have finished (replayable) */
  finished: Set<number>;
  onClose: () => void;
}

export function HandLog({ logs, currentHandId, onReplay, finished, onClose }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const lastLen = logs.length ? logs[logs.length - 1].lines.length : 0;
  const stick = useRef(true);
  useEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastLen, logs.length]);
  const recent = logs.slice(-12);
  const lastFinished = [...finished].sort((a, b) => b - a)[0];
  return (
    <aside className="log" aria-label="Hand log">
      <div className="log__head">
        <h2>Hand log</h2>
        <div className="log__head-actions">
          <button
            className="btn-ghost"
            disabled={lastFinished === undefined}
            onClick={() => lastFinished !== undefined && onReplay(lastFinished)}
            title="Watch the last finished hand again, step by step"
          >
            ⟲ Replay last hand
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Hide hand log" title="Hide log (L)">
            ×
          </button>
        </div>
      </div>
      <div
        className="log__body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {recent.length === 0 && <p className="log__empty">Actions will appear here as the hand plays out.</p>}
        {recent.map((l) => {
          const isCurrent = l.handId === currentHandId;
          const open = isCurrent || openIds.has(l.handId);
          return (
            <section key={l.handId} className={`log__hand ${isCurrent ? 'log__hand--current' : ''}`}>
              <button
                className="log__hand-head"
                onClick={() => {
                  if (isCurrent) return;
                  const s = new Set(openIds);
                  if (s.has(l.handId)) s.delete(l.handId);
                  else s.add(l.handId);
                  setOpenIds(s);
                }}
                aria-expanded={open}
              >
                <span>{l.lines[0]?.text}</span>
                {l.net !== undefined && (
                  <span className={`log__net ${l.net > 0 ? 'pos' : l.net < 0 ? 'neg' : ''}`}>
                    {l.net > 0 ? '+' : l.net < 0 ? '−' : ''}
                    {Math.abs(l.net)}
                  </span>
                )}
                {!isCurrent && <span className="log__chev">{open ? '▾' : '▸'}</span>}
              </button>
              {open && (
                <ul>
                  {l.lines.slice(1).map((ln, i) => (
                    <li key={i} className={`log__line log__line--${ln.kind}`}>
                      {ln.text}
                    </li>
                  ))}
                </ul>
              )}
              {finished.has(l.handId) && (
                <button className="log__replay" onClick={() => onReplay(l.handId)}>
                  Replay hand {l.handId}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
