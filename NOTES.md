# Poker Trainer — build notes

## How to run
- `npm install` (note: `rollup` is overridden to `@rollup/wasm-node` because Windows
  Application Control blocks rollup's native `.node` binary on this machine)
- `npm run dev` → http://localhost:5199
- `npm test`, `npm run typecheck`, `npm run sim`, `npm run e2e`

## Milestone 1 — Engine
Built:
- `src/engine/cards.ts` — card ints, parsing, seeded RNG (mulberry32), shuffle.
- `src/engine/evaluator.ts` — 5–7 card evaluator (packed int values), plain-language hand
  names, best-five finder.
- `src/engine/game.ts` — immutable NLHE hand state machine: blinds (incl. heads-up rule and
  short blinds), legal actions, min-raise rules, short all-in does not reopen (incl.
  cumulative short all-ins), uncalled-bet refunds, run-outs, side pots, showdown order and
  mucking, split pots with odd chip left of the button, event log for the UI.
- `src/engine/match.ts` — seats across hands, moving button skipping busted seats,
  auto-rebuy / manual rebuy.
- `src/engine/view.ts` — `PlayerView`: the only thing bots get (no other hole cards, no deck).
- Tests: exhaustive 5-card enumeration (all 2,598,960 hands match the known category
  counts), 7-card vs best-of-21 check, kickers/wheel/board-plays, side pots with 3 all-ins,
  short all-ins, min-raise sizing, heads-up order, showdown order/mucking, odd chip,
  20,000 random-hand chip-conservation run.

Design decisions:
- Blind rotation: "big blind always moves forward" (no dead button). Button and SB are the
  live seats right before the BB; heads-up, the non-BB player is button + SB.
- Folding when checking is free is not offered (engine rejects it).
- An opening bet smaller than 1 BB (all-in) still gives others a full decision; the next
  min raise is then that bet + 1 BB.
- When anyone is all-in at showdown every live hand is tabled; on an all-in run-out the
  hands are turned up (`reveal` events) before the remaining board is dealt.

### Critic round (Milestone 1)
- strategy-critic: **Not ready (0 blockers, 1 major)** → major (player posted BB twice when
  the table went heads-up) fixed with the BB-moves-forward rule + tests. Minors fixed: blind
  skipping on busts, pointless "call 1" for a HU SB facing a short-all-in BB, river all-in
  losers now shown, sub-BB opening bet min-raise covered by a test.
- ui-critic (engine API review): **Not ready (0 blockers, 5 majors)** → all fixed:
  actions can carry `pi`/`seq` and stale/out-of-turn actions are rejected; `reveal` events +
  `runout` flag on street events; `publicHand(state, viewer)` strips the deck and untabled
  hole cards (UI renders only from it); match layer is now immutable
  (`dealNextHand` returns `{match, hand}`); detailed hand names with kickers
  (`describeHandDetailed`) used in show/award events. Also added `callIsAllIn`,
  `raiseAllInOnly`, `matchOverReason`.
- No blockers in either review, so no re-run was required.

## Deferred
- (M1 ui minor) readonly types, per-event seq numbers, collect events, side-pot-first award
  order, best-five in show events — the display layer derives these.

## Milestone 2 — Playable table
Built:
- `src/ui/controller.ts` — framework-free match runner: paces engine events for animation,
  asks the bot worker for decisions (0.6–1.8 s natural delay, Space/click skips, "Fast"
  mode halves it), waits for user actions (guarded with `pi`/`seq`, no double submit),
  pauses while dialogs are open. The snapshot only ever holds `publicHand(...)`.
- `src/ui/display.ts` — derives what the table shows after the first k events (stacks,
  bets, pot/side pots, labels, revealed cards, awards) + hand-log text.
- `src/worker/botWorker.ts` + `src/ui/botClient.ts` — bot decisions run in a Web Worker.
  `src/bots/placeholder.ts` is the temporary bot.
- Components: `Table` (fixed 1100×640 stage scaled to fit → no layout shift; seats, cards
  with 3D flips, chips that slide to the pot and to winners, dealer button, timer ring),
  `ActionBar` (Fold / Check-Call / Bet-Raise, presets, slider, numeric input; illegal
  amounts disable the raise button; F/C/R/Enter/arrow keys, hints on hover),
  `HandLog` (collapsible, per-hand, replay links), `ReplayModal` (step/play any finished
  hand), `SetupScreen`, `Modal` (focus trap, Esc), HUD (style + VPIP/PFR).
- Four-colour deck; reduced motion via `MotionConfig reducedMotion="user"` + CSS.
- Playwright smoke test `tests/e2e/smoke.spec.ts` (uses installed Chrome: `npm run e2e`).
- Dev helpers: `scripts/shoot.mjs`, `scripts/shoot-replay.mjs` (screenshots with Playwright).
