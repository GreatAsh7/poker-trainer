/**
 * What a single player is allowed to know. Bots only ever receive a PlayerView, never a
 * HandState, so they cannot read other players' hole cards or the deck.
 */
import type { Card } from './cards';
import type { ActionRecord, HandState, LegalActions, Street, TableConfig } from './game';
import { legalActions, potTotal } from './game';

export interface PublicPlayer {
  pi: number;
  id: string;
  name: string;
  seat: number;
  stack: number;
  startStack: number;
  streetBet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
}

export interface PlayerView {
  handId: number;
  config: TableConfig;
  /** the viewer's player index */
  me: number;
  hole: Card[];
  players: PublicPlayer[];
  buttonPi: number;
  sbPi: number;
  bbPi: number;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  lastRaiseSize: number;
  lastAggressor: number;
  preflopAggressor: number;
  actions: ActionRecord[];
  legal: LegalActions | null;
}

export function viewFor(s: HandState, pi: number): PlayerView {
  return {
    handId: s.handId,
    config: s.config,
    me: pi,
    hole: [...s.players[pi].hole],
    players: s.players.map((p, i) => ({
      pi: i,
      id: p.id,
      name: p.name,
      seat: p.seat,
      stack: p.stack,
      startStack: p.startStack,
      streetBet: p.streetBet,
      totalBet: p.totalBet,
      folded: p.folded,
      allIn: p.allIn,
    })),
    buttonPi: s.buttonPi,
    sbPi: s.sbPi,
    bbPi: s.bbPi,
    street: s.street,
    board: [...s.board],
    pot: potTotal(s),
    currentBet: s.currentBet,
    lastRaiseSize: s.lastRaiseSize,
    lastAggressor: s.lastAggressor,
    preflopAggressor: s.preflopAggressor,
    actions: s.actions.map((a) => ({ ...a })),
    legal: s.toAct === pi ? legalActions(s) : null,
  };
}
