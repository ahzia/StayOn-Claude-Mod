// SPDX-License-Identifier: MIT
// A stand-in for the engine beneath the plugin in tests: one project folder
// held in memory, a mock clock and store, and the calls a session answers.

import { mock } from 'claude-code/testing'
import type { test } from 'claude-code/testing'

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: any[]) => any>>[1]

export const ROOT = '/work/demo'
export const FILE = `${ROOT}/TASKS.md`

export type World = {
  files: Map<string, string>
  mtimes: Map<string, number>
  writes: number
  failReads: boolean
  opened: number
  notifications: string[]
  clock: ReturnType<typeof mock.clock>
  /** Edits a file as a person or another tool would, outside StayOn. */
  edit: (path: string, text: string) => void
}

export function world(on: On, files: Record<string, string> = {}): World {
  const w: World = {
    files: new Map(Object.entries(files)),
    mtimes: new Map(Object.keys(files).map(k => [k, 1])),
    writes: 0,
    failReads: false,
    opened: 0,
    notifications: [],
    clock: mock.clock(on, { now: 1_000_000 }),
    edit(path, text) {
      w.files.set(path, text)
      w.mtimes.set(path, (w.mtimes.get(path) ?? 0) + 1)
    },
  }
  mock.store(on)
  // The engine's own nouns, answered loosely: each returns `{ value }` as a session would.
  const stub = on as unknown as (event: string, hook: (...args: any[]) => unknown) => void

  stub('session.root', async () => ({ value: ROOT }))
  stub('session.surfaces', async () => ({ value: ['terminal'] }))
  stub('fs.exists', async (_$: unknown, e: { path: string }) => ({ value: w.files.has(e.path) }))
  stub('fs.stat', async (_$: unknown, e: { path: string }) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file', size: text.length, mtimeMs: w.mtimes.get(e.path) ?? 0, isLink: false } }
  })
  stub('fs.read', async (_$: unknown, e: { path: string }) => {
    if (w.failReads) throw new Error('EACCES: permission denied')
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  stub('fs.write', async (_$: unknown, e: { path: string; text: string }) => {
    w.writes++
    w.edit(e.path, e.text)
    return { value: undefined }
  })
  stub('ui.open', async () => {
    w.opened++
    return { value: { isPlaced: true } }
  })
  stub('ui.notify', async (_$: unknown, e: { text: string }) => {
    w.notifications.push(e.text)
    return { value: { isSent: true, channel: 'test' } }
  })
  stub('command.register', async () => ({ value: undefined }))
  stub('tool.register', async () => ({ value: { tool: 'mcp__stayon__tasks' } }))
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd?: string }).cwd ?? ROOT }) as never)
  on('session.end', async () => ({ sessionId: 'test' }) as never)
  on('command.run', async () => ({ text: '' }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('tool.call', async () => ({ result: 'ok' }))
  on('classic.Notification', async () => ({}) as never)
  // What the engine draws when StayOn steps aside (an empty band).
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e as never) as { Box: (p: object) => unknown }
    return Box({ key: 'engine-default' }) as never
  })
  return w
}

export const PANE = {
  plugin: 'stayon',
  component: 'Pane',
  requestId: 'stayon',
  props: {
    title: 'StayOn',
    isFocused: true,
    bodyColumns: 46,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

export const BAND = {
  plugin: 'stayon',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

/** Everything a drawing shows, as one string, for loose assertions. */
export function textOf(tree: unknown): string {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  const node = tree as { props?: { label?: string }; children?: unknown[] }
  return `${node.props?.label ?? ''}${textOf(node.children ?? [])}`
}
