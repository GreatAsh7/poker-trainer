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

### Critic round (Milestone 2)
- strategy-critic: **Not ready (0 blockers, 2 majors)** → fixed: pot odds now count only
  chips you can win (all-in-for-less / side-pot cases, `potOdds()` in presets.ts + tests);
  side-pot list no longer shows awarded pots. Minors fixed: `publicHand` now cuts events,
  board and actions to what has been shown; iso-raise sizes over limpers, 2.2x/2.5x 4-bet
  presets, clearer raise tooltips; showdown log lines include the cards; "Uncalled bet (N)
  returned"; full board on turn/river log lines; BB all-in posts marked; consistent minus
  signs; HUD ignores walks. New tests: tests/unit/ui-logic.test.ts (pots add up and no hidden
  cards at every display step over 2,000 random hands).
- ui-critic: **Not ready (0 blockers, 6 majors)** → fixed: 1024-wide layout (log becomes a
  drawer below 1280 px, no empty column); action labels moved beside the nameplate, hand
  name replaces the HUD badge at showdown, labels cleared when cards are tabled; Enter on a
  preset submits the raise; shortcuts work after clicking HUD/Fast; side pots readable and
  correctly named during awards, busted players show 0; showdowns held ~4 s with a "Next
  hand (Space)" button. Minors fixed: slider arrows step by 1 BB, per-hand result in the log
  and no forced scrolling, bigger replay table, leave dialog focuses "Keep playing", setup
  radio groups use arrow keys/roving tabindex, always five presets, dealer button no longer
  under labels.
- No blockers, so no re-run was required.

Deferred (M2 minors): refund chips don't visibly slide back to the bettor; hot-reload during
dev stops a running match (dev only).

## Milestone 3 — Strategic bots
Built (all pure TS in `src/bots/`, run in the Web Worker):
- `combos.ts` — 1326 combos / 169 classes, range notation parser with mixed frequencies.
- `preflopCharts.ts` + `data/preflop169.json` (equity of every class vs 1 and 3 random
  hands, generated by `scripts/gen-preflop.ts`) — 6-max RFI, 3-bet, flat, BB-defence,
  vs-3-bet, vs-4-bet charts; ranking used to widen/tighten ranges.
- `equity.ts` — Monte Carlo equity vs weighted ranges (exact on the river heads-up).
- `strength.ts` — per-board strength percentiles, draw detection, board texture.
- `rangeModel.ts` — each opponent's range from their public actions: preflop charts scaled by
  their observed VPIP/PFR/3-bet, then narrowed street by street with action likelihoods that
  scale with their observed aggression and with bluffs seen at showdown.
- `strategy.ts` — preflop (charts, sizing, push/fold ≤ 13 BB, equity decisions vs all-ins),
  postflop (equity vs ranges, pot odds, equity realisation by position, implied odds for
  draws, texture/street/SPR sizing, value/semi-bluff/bluff frequencies, c-bets).
- `personalities.ts` — Expert, Solid (TAG), Aggressive (LAG), Tight-passive (nit), Calling
  station on the same core. Only Expert adapts (3-bets players who over-fold, bluff-catches
  proven bluffers, value-bets thinner vs stations, c-bets more vs over-folders...).
- `stats.ts` — VPIP, PFR, 3-bet, fold to 3-bet, c-bet, fold to c-bet, AF, WTSD, W$SD, river
  bluffs seen at showdown, by position. Shared by bots, HUD and the coaching report.
- `baselines.ts` — random-legal, always-call, always-raise (maniac).
- App: setup screen "Opponents" (Mixed / Expert table / Softer table); the controller sends
  every bot the public stats of all players so they adapt over the match.

Measured with `npm run sim -- --hands 60000` (opponent reads reset every 50 hands, like a
new match in the app; duplicate format; 60,000 hands per heads-up row, 120,000 per 6-max row;
0 illegal actions). Expert bb/100 with 95% CI:

| Format | Opponent | 100 BB | 40 BB | 20 BB |
|---|---|---|---|---|
| Heads-up | Solid (TAG) | +10.3 ± 6.4 | +14.7 ± 5.4 | +41.0 ± 3.7 |
| Heads-up | Aggressive (LAG) | +113.5 ± 12.0 | +48.3 ± 7.8 | +42.8 ± 4.8 |
| Heads-up | Tight-passive (nit) | +7.8 ± 4.9 | +6.1 ± 4.8 | +21.8 ± 3.4 |
| Heads-up | Calling station | +137.3 ± 7.8 | +114.6 ± 8.1 | +81.0 ± 4.9 |
| Heads-up | Exploit: 3-bets every open | +82.0 ± 9.9 | — | +202.5 ± 5.3 |
| Heads-up | Exploit: shoves every hand | +635.2 ± 39.0 | +216.9 ± 15.7 | +71.4 ± 7.5 |
| Heads-up | Random legal / always call / maniac | +420.9 / +454.6 / +750.7 | — | — |
| 6-max, Expert vs 5 copies | TAG / LAG / nit / station | +6.4 ± 3.4 / +25.5 ± 5.2 / +4.4 ± 3.2 / +153.2 ± 9.3 | — | — |

6-max ring (`npm run sim:ring -- 16000`): personalities clearly distinct (e.g. VPIP/PFR
TAG 21/16, LAG 33/27, nit 13/8, station 34/6, Expert 27/21; open % UTG→BTN for TAG
17/23/32/43). Decision time p99 ≈ 2 ms, max ≈ 10 ms.

### Critic round (Milestone 3)
- strategy-critic round 1: **Not ready (3 blockers, 3 majors)**.
  - Blocker: the Expert's edge came from 10k-hand reads; at app match lengths it did not beat
    TAG/LAG → the sim now resets reads every 50 hands, tests 100/40/20 BB and 6-max (Expert vs
    five copies of each bot), and fails on any illegal action. Strategy fixes: heavier
    shrinkage on reads (no exploiting noise), exploits gated on ≥ 20 hands, range-proportional
    3-bet defence, fold-equity re-shoves at ≤ 40 BB, aggression-aware range likelihoods (medium
    hands bet more by aggressive players; passive players check/call monsters), fold-to-bet
    stat for bluff frequency. Simpler personalities now read hands less precisely
    (`rangeReading`), TAG folds a bit too easily as its description says.
  - Blocker: "3-bet every open" beat the Expert → defends the top ~58% (HU) / 46% (IP) / 38%
    (OOP) of its own opening range; now +82 / +203 bb/100 against that exploit.
  - Blocker: "jam any two" ~broke even → range model represents very loose players (floors scale
    with VPIP/PFR/3-bet, caps raised), shoves use position/depth push ranges; now +635 / +217 / +71.
  - Majors fixed: Expert mixes river sizes independently of strength; as the caller it checks to
    the preflop raiser with most of its range; sim measures app conditions.
  - Minors fixed: board-only straight draws no longer count, BB check narrows the range, fold
    reasons show realised equity, dead code removed, Expert bluffs the river more.
