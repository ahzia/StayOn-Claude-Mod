// SPDX-License-Identifier: MIT
// What the main Claude loop is doing. A pure reducer, no `$`.

import type { AgentState, TurnEndReason } from '../../types'

export type { AgentPhase, AgentState, TurnEndReason } from '../../types'

export type AgentEvent =
  | { type: 'turn_start'; turnId: string; at: number }
  | { type: 'subagent_start' }
  | { type: 'subagent_end' }
  | { type: 'needs_user'; at: number }
  | { type: 'resumed'; at: number }
  | { type: 'turn_end'; turnId: string; reason: TurnEndReason; durationMs: number; at: number }
  | { type: 'reset'; at: number }

export const INITIAL_AGENT: AgentState = { phase: 'idle', since: 0, subagents: 0 }

export function reduceAgent(state: AgentState, event: AgentEvent): AgentState {
  switch (event.type) {
    case 'turn_start':
      return { phase: 'working', since: event.at, turnId: event.turnId, subagents: 0, lastEnd: state.lastEnd }
    case 'subagent_start':
      return { ...state, subagents: state.subagents + 1 }
    case 'subagent_end':
      return { ...state, subagents: Math.max(0, state.subagents - 1) }
    case 'needs_user':
      return state.phase === 'working' ? { ...state, phase: 'needs_user', since: event.at } : state
    case 'resumed':
      return state.phase === 'needs_user' ? { ...state, phase: 'working', since: event.at } : state
    case 'turn_end':
      // A late end of an older turn must not end the one in flight.
      if (state.turnId !== undefined && event.turnId !== state.turnId) return state
      return {
        phase: 'ready',
        since: event.at,
        turnId: event.turnId,
        subagents: 0,
        lastEnd: { reason: event.reason, durationMs: event.durationMs },
      }
    case 'reset':
      return { ...INITIAL_AGENT, since: event.at }
  }
}

/** True while Claude is busy on its own (not waiting for the person). */
export function isBusy(state: AgentState): boolean {
  return state.phase === 'working'
}
