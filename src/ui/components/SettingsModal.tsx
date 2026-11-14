import type { Prefs } from '../settings';
import { DEFAULT_PREFS } from '../settings';
import { Modal } from './Modal';
import { play, setSound } from '../sound';

interface Props {
  prefs: Prefs;
  onChange: (p: Prefs) => void;
  onClose: () => void;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label">{label}</span>
        {hint && <span className="setting__hint">{hint}</span>}
      </div>
      <div className="setting__control">{children}</div>
    </div>
  );
}

function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented segmented--small" role="radiogroup" aria-label={label}>
      {options.map(([v, l], i) => (
        <button
          key={String(v)}
          role="radio"
          aria-checked={v === value}
          tabIndex={v === value ? 0 : -1}
          className={`segmented__opt ${v === value ? 'segmented__opt--on' : ''}`}
          onClick={() => onChange(v)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const j = (i + d + options.length) % options.length;
            onChange(options[j][0]);
            (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="toggle__track" aria-hidden />
    </label>
  );
}

export function SettingsModal({ prefs, onChange, onClose }: Props) {
  const set = (patch: Partial<Prefs>) => onChange({ ...prefs, ...patch });
  const think = `${prefs.thinkMin}-${prefs.thinkMax}`;
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings">
        <Row label="Bot thinking time" hint="How long bots pause before acting. Space skips a pause.">
          <Choice
            label="Bot thinking time"
            value={think}
            options={[
              ['0.2-0.5', 'Quick'],
              ['0.6-1.8', 'Natural'],
              ['1.2-2.8', 'Slow'],
            ]}
            onChange={(v) => {
              const [a, b] = v.split('-').map(Number);
              set({ thinkMin: a, thinkMax: b });
            }}
          />
        </Row>
        <Row label="Animation speed">
          <Choice
            label="Animation speed"
            value={prefs.pace}
            options={[
              [1, 'Normal'],
              [0.6, 'Fast'],
              [0.35, 'Very fast'],
            ]}
            onChange={(v) => set({ pace: v })}
          />
        </Row>
        <Row label="Pause after each hand" hint="Wait for “Next hand” (Space) instead of continuing automatically.">
          <Toggle label="Pause after each hand" checked={prefs.pauseAfterHand} onChange={(v) => set({ pauseAfterHand: v })} />
        </Row>
        <Row label="Decision timer" hint="Optional time limit for your decisions. When it runs out you check, or fold to a bet.">
          <Choice
            label="Decision timer"
            value={prefs.turnTimer}
            options={[
              [0, 'Off'],
              [30, '30 s'],
              [15, '15 s'],
            ]}
            onChange={(v) => set({ turnTimer: v })}
          />
        </Row>
        <Row label="Show pot odds" hint="The “you need X% equity” helper above the action buttons.">
          <Toggle label="Show pot odds" checked={prefs.showPotOdds} onChange={(v) => set({ showPotOdds: v })} />
        </Row>
        <Row label="Opponent HUD" hint="Each bot's style, VPIP and PFR under their name (H).">
          <Toggle label="Opponent HUD" checked={prefs.showHud} onChange={(v) => set({ showHud: v })} />
        </Row>
        <Row label="Sound effects" hint="Cards, chips, your turn and wins. Quiet table cues, no music.">
          <div className="setting__sound">
            <Toggle
              label="Sound effects"
              checked={prefs.sound}
              onChange={(v) => {
                set({ sound: v });
                setSound(v, prefs.volume);
                if (v) play('chip');
              }}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={prefs.volume}
              disabled={!prefs.sound}
              aria-label="Volume"
              onChange={(e) => {
                const vol = Number(e.target.value);
                set({ volume: vol });
                setSound(prefs.sound, vol);
              }}
              onPointerUp={() => play('chip')}
              onKeyUp={() => play('chip')}
            />
          </div>
        </Row>
        <div className="settings__foot">
          <button className="btn-ghost" onClick={() => onChange({ ...DEFAULT_PREFS })}>
            Reset to defaults
          </button>
          <button className="btn btn--primary btn--small" onClick={onClose} data-autofocus>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
