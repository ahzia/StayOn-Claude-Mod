// SPDX-License-Identifier: MIT
// Agent phase reducer and suggestion ranking: pure, no engine needed.

import { expect, test } from 'claude-code/testing'

import { INITIAL_AGENT, reduceAgent } from '../hooks/core/agent'
import type { AgentEvent, AgentState } from '../hooks/core/agent'
import { isEligible, nextSuggestion, rankSuggestions } from '../hooks/core/recommend'
import { parseTaskFile } from '../hooks/core/taskfile'

const run = (events: AgentEvent[]): AgentState => events.reduce(reduceAgent, INITIAL_AGENT)

test('main turn: idle → working → needs you → working → ready', () => {
  let s = run([{ type: 'turn_start', turnId: 't1', at: 1 }])
  expect(s.phase).toBe('working')
  s = reduceAgent(s, { type: 'needs_user', at: 2 })
  expect(s.phase).toBe('needs_user')
  s = reduceAgent(s, { type: 'resumed', at: 3 })
  expect(s.phase).toBe('working')
  s = reduceAgent(s, { type: 'turn_end', turnId: 't1', reason: 'answer', durationMs: 9, at: 4 })
  expect(s.phase).toBe('ready')
  expect(s.lastEnd).toEqual({ reason: 'answer', durationMs: 9 })
})

test('subagents are counted, a stale end is ignored, needs-you only while working', () => {
  let s = run([
    { type: 'turn_start', turnId: 't2', at: 1 },
    { type: 'subagent_start' },
    { type: 'subagent_start' },
    { type: 'subagent_end' },
  ])
  expect([s.phase, s.subagents]).toEqual(['working', 1])
  s = reduceAgent(s, { type: 'turn_end', turnId: 'old', reason: 'answer', durationMs: 1, at: 2 })
  expect(s.phase).toBe('working')
  expect(reduceAgent(INITIAL_AGENT, { type: 'needs_user', at: 1 }).phase).toBe('idle')
  expect(reduceAgent(s, { type: 'reset', at: 5 }).phase).toBe('idle')
})

const TASKS = parseTaskFile(
  [
    '- [ ] Agent work <!-- stayon:id=T-001 -->',
    '  - Owner: agent',
    '- [ ] Long human job <!-- stayon:id=T-002 -->',
    '  - Owner: human',
    '  - Estimate: 2h',
    '- [ ] Blocked review <!-- stayon:id=T-003 -->',
    '  - Owner: human',
    '  - Status: blocked',
    '- [ ] Waits on agent <!-- stayon:id=T-004 -->',
    '  - Owner: human',
    '  - Depends on: T-001',
    '- [ ] Either, low <!-- stayon:id=T-005 -->',
    '  - Priority: low',
    '- [ ] Human, quick <!-- stayon:id=T-006 -->',
    '  - Owner: human',
    '  - Estimate: 2m',
    '- [ ] Human, high <!-- stayon:id=T-007 -->',
    '  - Owner: human',
    '  - Priority: high',
    '- [x] Done already <!-- stayon:id=T-008 -->',
    '  - Owner: human',
  ].join('\n'),
).tasks

test('never suggests agent, blocked, long, dependent or done tasks', () => {
  const ids = TASKS.filter(t => isEligible(t, TASKS)).map(t => t.id)
  expect(ids).toEqual(['T-005', 'T-006', 'T-007'])
})

test('ranks human, high priority and short first, then rotates until caught up', () => {
  expect(rankSuggestions(TASKS).map(t => t.id)).toEqual(['T-007', 'T-006', 'T-005'])
  expect(nextSuggestion(TASKS, [])?.id).toBe('T-007')
  expect(nextSuggestion(TASKS, ['T-007'])?.id).toBe('T-006')
  expect(nextSuggestion(TASKS, ['T-007', 'T-006', 'T-005'])).toBe(undefined)
  expect(nextSuggestion([], [])).toBe(undefined)
})
