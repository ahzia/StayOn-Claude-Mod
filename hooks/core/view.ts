// SPDX-License-Identifier: MIT
// Formatting and filtering for the UI. Pure, no `$`.

import type { Filter } from '../../types'
import type { Owner, Status, Task } from './taskfile'

export const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'claude', label: 'Claude' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

export function applyFilter(tasks: readonly Task[], filter: Filter, hideDone: boolean): Task[] {
  switch (filter) {
    case 'all':
      return tasks.filter(t => !(hideDone && t.done))
    case 'mine':
      return tasks.filter(t => t.owner !== 'agent' && !(hideDone && t.done))
    case 'claude':
      return tasks.filter(t => t.owner !== 'human' && !(hideDone && t.done))
    case 'review':
      return tasks.filter(t => t.status === 'needs_review' || t.status === 'blocked')
    case 'done':
      return tasks.filter(t => t.done)
  }
}

export const OWNER_LABEL: Record<Owner, string> = { human: 'you', agent: 'Claude', either: 'either' }
export const NEXT_OWNER: Record<Owner, Owner> = { human: 'agent', agent: 'either', either: 'human' }

/** A one-glyph checkbox that also says the status, for people who can't see color. */
export function checkGlyph(task: Task): string {
  const mark: Record<Status, string> = {
    ready: ' ',
    in_progress: '~',
    blocked: '!',
    needs_review: '?',
    done: 'x',
    cancelled: '-',
  }
  return `[${mark[task.status]}]`
}

export const STATUS_LABEL: Record<Status, string> = {
  ready: 'ready',
  in_progress: 'in progress',
  blocked: 'blocked',
  needs_review: 'needs review',
  done: 'done',
  cancelled: 'cancelled',
}

export function progressBar(done: number, total: number, width: number): string {
  if (total === 0 || width <= 0) return ''
  const filled = Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function truncate(text: string, width: number): string {
  if (width <= 1) return text.slice(0, Math.max(0, width))
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`
}

/** "claude: write tests" → owner agent; "me: review copy" → owner human; otherwise human. */
export function parseQuickAdd(raw: string): { title: string; owner: Owner } {
  const m = raw.match(/^\s*@?(claude|agent|ai|me|human|either|any)\s*[:>]\s*(.*)$/i)
  if (!m) return { title: raw, owner: 'human' }
  const who = m[1]!.toLowerCase()
  const owner: Owner = who === 'me' || who === 'human' ? 'human' : who === 'either' || who === 'any' ? 'either' : 'agent'
  return { title: m[2]!, owner }
}

export function describeTask(task: Task): string {
  const parts = [task.owner === 'agent' ? 'Claude' : task.owner === 'human' ? 'yours' : 'anyone']
  if (task.estimateMinutes !== undefined) parts.unshift(`~${task.estimateMinutes} min`)
  if (task.priority) parts.push(`${task.priority} priority`)
  return parts.join(' · ')
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}
