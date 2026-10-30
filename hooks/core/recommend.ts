// SPDX-License-Identifier: MIT
// Which task to suggest while Claude works. Pure and deterministic, no `$`.

import type { Task } from './taskfile'

/** Longer than this and it is not a "while Claude works" task. */
export const MAX_SUGGEST_MINUTES = 30

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const

/** A task the person could pick up now, independent of Claude's current work. */
export function isEligible(task: Task, all: readonly Task[]): boolean {
  if (task.done || task.status !== 'ready') return false
  if (task.owner === 'agent') return false
  if (task.estimateMinutes !== undefined && task.estimateMinutes > MAX_SUGGEST_MINUTES) return false
  const byId = new Map(all.map(t => [t.id, t]))
  // A dependency that is missing from the file counts as unmet: we cannot tell it is done.
  return task.dependsOn.every(dep => byId.get(dep)?.done === true)
}

/** Eligible tasks, best first: human-owned, higher priority, short and known estimates, file order. */
export function rankSuggestions(tasks: readonly Task[]): Task[] {
  const score = (t: Task) => [
    t.owner === 'human' ? 0 : 1,
    t.priority !== undefined ? PRIORITY_RANK[t.priority] : 1.5,
    t.estimateMinutes ?? 15,
  ]
  return tasks
    .filter(t => isEligible(t, tasks))
    .map((t, order) => ({ t, order, s: score(t) }))
    .sort((a, b) => {
      for (let i = 0; i < a.s.length; i++) {
        const d = a.s[i]! - b.s[i]!
        if (d !== 0) return d
      }
      return a.order - b.order
    })
    .map(x => x.t)
}

/**
 * The next suggestion, skipping everything already shown this turn.
 * `undefined` means the person is caught up.
 */
export function nextSuggestion(tasks: readonly Task[], shown: readonly string[]): Task | undefined {
  const skip = new Set(shown)
  return rankSuggestions(tasks).find(t => !skip.has(t.id))
}
