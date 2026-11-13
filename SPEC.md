# Poker Trainer — product spec

A local practice app: the user plays No-Limit Texas Hold'em against strong, strategic bots,
and after every match gets a coaching report on what they did well, what they missed, and
how to play better next time.

Two goals outrank everything else. When they conflict with anything else (scope, speed,
cleverness), they win:

1. **The UI is flawless, smooth and pleasant to play in.**
2. **The bots play real strategy, and the coaching is accurate and useful.**

The owner is learning poker: in-app explanations use plain language, with numbers.

## Stack (decided)

- Browser app: Vite + React + TypeScript (strict), runs with `npm run dev`, no backend,
  no API keys. All game logic, bots and analysis run client-side.
- Animation: Framer Motion (or CSS transforms) — GPU-friendly transforms/opacity only.
- Heavy work (equity Monte Carlo, bot thinking, report generation) runs in a Web Worker so
  the UI thread never stalls.
- Tests: Vitest for engine/bots/analysis; Playwright for UI smoke + screenshots.
- Layout: `poker-trainer/` is the app root. Keep engine, bots, analysis and UI in separate
  folders (`src/engine`, `src/bots`, `src/analysis`, `src/ui`). Engine and bots must be pure
  TypeScript with no React imports, so they can be tested and simulated headless.

## Game

- NLHE, 2–6 seats (default 6-max: user + 5 bots). Blinds 1/2, 100 BB starting stacks
  (configurable 20–200 BB).
- A **match** = a set number of hands (default 50; options 25/50/100) or until the user
  busts. Optional "rebuy" toggle.
- Fully correct rules: blinds/button rotation, heads-up blind rules, min-raise rules,
  all-in and short all-in (incomplete raise does not reopen action), side pots, split pots,
  odd-chip rule, showdown order, mucking, hand ranking with kickers. Engine is exhaustively
  unit-tested.

## UI requirements

- A table that looks like a premium poker client: felt, seats around an oval, chip stacks,
  dealer button, pot display, community cards, clear "whose turn" indicator with a timer
  ring (timer optional/off by default for practice).
- Smooth animations: dealing, chips moving to pot and to the winner, card flips, fold
  mucks. 60 fps; no layout shift; nothing jumps or flickers. Bots "think" for a short,
  natural-feeling delay (≈0.6–1.8 s, configurable, skippable).
- Action bar: Fold / Check-Call (shows amount) / Bet-Raise with a slider + numeric input +
  presets (⅓, ½, ⅔, pot, all-in; preflop 2.5x/3x/…). Illegal amounts are impossible to
  submit. Keyboard shortcuts (F, C, R, Enter, arrow keys for slider) shown on hover.
- Always-visible info: pot, each stack in chips and BB, current bet to call, pot odds when
  facing a bet. Toggleable HUD showing each bot's style label and basic stats (VPIP/PFR).
- Hand log panel (collapsible) with readable action history; last-hand replay.
- Responsive from 1280×720 up to 2560×1440; usable at 1024 wide. Light/dark not required —
  one polished theme. Accessible contrast, focus states, reduced-motion support.
- Never blocks on computation: bot decisions and analysis come from the worker.

## Bots

- Strategy core, not random rules: preflop ranges by position and action (open, 3-bet,
  call, 4-bet, push/fold when short), postflop decisions from equity vs an estimated
  opponent range, pot odds, board texture, position, SPR, and sensible bet sizing
  (c-bets, value bets, bluffs with balanced frequencies, semi-bluffs with draws).
- Range narrowing: bots update an opponent's estimated range from their actions.
- 3–4 distinct personalities on the same core (e.g. solid TAG reg, aggressive LAG,
  tight-passive nit, loose station), plus an "Expert" mode where all bots play the
  strongest balanced strategy. Difficulty selectable per match.
- Bots adapt over a match: track the user's tendencies (VPIP, PFR, fold-to-c-bet,
  aggression) and exploit obvious leaks.
- Bots never see hidden cards. Decision time < 300 ms in the worker.
- Measured strength: in headless simulation over ≥ 20k hands, the Expert bot must beat
  each simpler personality and a set of baseline bots (random-legal, calling station,
  always-raise maniac) by a clear, reported margin (bb/100 with confidence interval).

## Match report (coaching)

Shown at the end of each match, and available per hand from the log.

- Results: net chips/BB, bb/100, biggest pots won/lost, all-in EV vs actual (luck).
- Stats vs reference ranges: VPIP, PFR, 3-bet %, c-bet %, fold to c-bet, aggression,
  WTSD, by position — with a plain-language verdict for each.
- **Key hands** (3–6): the hands with the biggest EV swing. For each: the situation,
  what the user did, what a strong player would do and *why* (equity, pot odds, range
  reasoning, position, sizing), and the estimated EV cost of the mistake.
- **What you did well**: specific good decisions with the reasoning.
- **Strategies you could have used**: e.g. exploiting a bot that over-folds, stealing more
  from the button, value betting thinner, using pot odds on draws.
- **Overall assessment + next-match plan**: a short grade and 2–3 concrete focus points.
- Every claim in the report is backed by a computed number (equity, odds, EV, frequency)
  — no generic filler. Wording must be correct poker: if unsure, say less.
- Reports persist in localStorage so the user can see progress across matches.

## Definition of done (per milestone)

Builder must not call a milestone done until both critics (`ui-critic`,
`strategy-critic`) have reviewed it and every "blocker" finding is fixed.
