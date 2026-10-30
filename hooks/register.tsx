// SPDX-License-Identifier: MIT
// StayOn for Claude Code: the hooks module.
//
// Wires Claude Code events to StayOn's pure core (hooks/core/*):
//   TASKS.md  ⇄  task pane            (Phase 1: the checklist)
//   main turn →  one suggestion band  (Phase 2: "while Claude works")
//   turn end  →  return cue           (Phase 2: back to Claude)
// Every `$` call lives in this file; logic that does not need `$` lives in core/.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CueState, FileView, Filter, MomentState, Notice, Undo, ViewState } from '../types'
import { INITIAL_AGENT, reduceAgent } from './core/agent'
import type { AgentEvent } from './core/agent'
import { nextSuggestion } from './core/recommend'
import {
  addTask,
  parseTaskFile,
  removeTask,
  setDone,
  setOwner,
  setStatus,
  setTitle,
  TaskEditError,
} from './core/taskfile'
import type { EditResult, Owner, Status, Task, TaskFile } from './core/taskfile'
import {
  applyFilter,
  checkGlyph,
  describeTask,
  FILTERS,
  formatDuration,
  NEXT_OWNER,
  OWNER_LABEL,
  parseQuickAdd,
  progressBar,
  STATUS_LABEL,
  truncate,
} from './core/view'

// ---------------------------------------------------------------------------
// Constants and session state

const PANE = 'stayon'
const COMMAND = 'stayon'
const TOOL = 'mcp__stayon__tasks'
const POLL_MS = 2500
const SNOOZE_MS = 30 * 60 * 1000
const MAX_ROWS = 200

const agentA = atom({ plugin: 'stayon', key: 'agent' } as const, INITIAL_AGENT)
const fileA = atom({ plugin: 'stayon', key: 'file' } as const, {
  status: 'loading',
  path: '',
  text: '',
  mtimeMs: 0,
  size: 0,
} as FileView)
const viewA = atom({ plugin: 'stayon', key: 'view' } as const, {
  filter: 'all',
  hideDone: false,
  selectedId: null,
  mode: 'list' as const,
  confirmDeleteId: null,
} as ViewState)
const momentA = atom({ plugin: 'stayon', key: 'moment' } as const, {
  turnId: null,
  revealed: false,
  dismissed: false,
  currentId: null,
  shown: [],
  startedId: null,
} as MomentState)
const cueA = atom({ plugin: 'stayon', key: 'cue' } as const, { visible: false } as CueState)
const noticeA = atom({ plugin: 'stayon', key: 'notice' } as const, null as Notice | null)

/** userConfig values, read once per load (a change in the config menu reloads the module). */
type Options = {
  taskFile: string
  suggestions: boolean
  suggestDelaySeconds: number
  notifyAfterSeconds: number
  openOnStart: boolean
}
let opts: Options = {
  taskFile: '',
  suggestions: true,
  suggestDelaySeconds: 5,
  notifyAfterSeconds: 60,
  openOnStart: true,
}

function readOptions(raw: Record<string, unknown>): Options {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    taskFile: typeof raw.taskFile === 'string' ? raw.taskFile.trim() : '',
    suggestions: bool(raw.suggestions, true),
    suggestDelaySeconds: num(raw.suggestDelaySeconds, 5),
    notifyAfterSeconds: num(raw.notifyAfterSeconds, 60),
    openOnStart: bool(raw.openOnStart, true),
  }
}

// ---------------------------------------------------------------------------
// Small helpers ($ is passed down; these are all top-level functions)

// Writes only when the value changed: a redraw between a press and its release loses the click.
async function setFile($: any, value: FileView): Promise<void> {
  const current: FileView = await read($, fileA)
  if (JSON.stringify(current) !== JSON.stringify(value)) await update($, fileA, () => value)
}

async function setCue($: any, value: CueState): Promise<void> {
  const current: CueState = await read($, cueA)
  if (current.visible !== value.visible) await update($, cueA, () => value)
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isAbsolute(path: string): boolean {
  return /^([A-Za-z]:)?[\\/]/.test(path)
}

async function resolvePath($: any): Promise<string> {
  const root: string = await $.session.root()
  const inRoot = (p: string) => (isAbsolute(p) ? p : `${root.replace(/[\\/]$/, '')}/${p}`)
  if (opts.taskFile !== '') return inRoot(opts.taskFile)
  for (const candidate of ['TASKS.md', '.stayon/TASKS.md']) {
    if (await $.fs.exists(inRoot(candidate))) return inRoot(candidate)
  }
  return inRoot('TASKS.md')
}

/**
 * Reads the task file into state. Only a missing file counts as empty; any
 * other failure keeps the last good text and reports the error, and nothing
 * is ever written after a failed read. Unchanged files cause no redraw.
 */
async function load($: any, force = false): Promise<void> {
  const path = await resolvePath($)
  const current: FileView = await read($, fileA)
  if (!(await $.fs.exists(path))) {
    await setFile($, { status: 'missing', path, text: '', mtimeMs: 0, size: 0 })
    return
  }
  try {
    const stat = await $.fs.stat(path)
    const isSame =
      current.status === 'ok' && current.path === path && current.mtimeMs === stat.mtimeMs && current.size === stat.size
    if (isSame && !force) return
    const text: string = await $.fs.read(path)
    await setFile($, { status: 'ok', path, text, mtimeMs: stat.mtimeMs, size: stat.size })
  } catch (err) {
    await setFile($, { ...current, status: 'error', path, error: errorText(err) })
  }
}

async function loadQuietly($: any): Promise<void> {
  try {
    await load($)
  } catch {
    // A poll that fails is retried on the next tick; it must never surface as a hook failure.
  }
}

async function taskFile($: any): Promise<TaskFile> {
  const file: FileView = await read($, fileA)
  // After a failed read the last good copy is still shown (read-only in effect: every edit re-reads first).
  return file.status === 'ok' || file.status === 'error' ? parseTaskFile(file.text) : { tasks: [], duplicateIds: [] }
}

async function findTask($: any, id: string | null): Promise<Task | undefined> {
  if (id === null) return undefined
  return (await taskFile($)).tasks.find(t => t.id === id)
}

/**
 * Applies one edit to the freshest copy of the file and writes it back.
 * Edits address tasks by stable id, so a change someone else made a moment
 * earlier is kept, not overwritten.
 */
async function mutate($: any, edit: (text: string) => EditResult): Promise<EditResult> {
  const path = await resolvePath($)
  const before: string = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const result = edit(before)
  if (result.text !== before) await $.fs.write(path, result.text)
  await load($, true)
  return result
}

async function notify($: any, text: string, isError = false, undo: Undo | null = null): Promise<void> {
  await update($, noticeA, () => ({ text, isError, undo }))
}

/** Runs an edit and reports the outcome in the pane; never throws. */
async function act(
  $: any,
  describe: (result: EditResult) => string,
  edit: (text: string) => EditResult,
  undo?: (result: EditResult) => Undo,
): Promise<EditResult | undefined> {
  try {
    const result = await mutate($, edit)
    await notify($, describe(result), false, undo ? undo(result) : null)
    return result
  } catch (err) {
    const message = err instanceof TaskEditError ? err.message : `Could not update the task file: ${errorText(err)}`
    await notify($, message, true)
    return undefined
  }
}

const target = (task: Task) => ({ id: task.id, title: task.title })

// ---------------------------------------------------------------------------
// Task actions

async function toggleDone($: any, task: Task): Promise<EditResult | undefined> {
  return act(
    $,
    () => (task.done ? `Reopened: ${task.title}` : `Done: ${task.title}`),
    text => setDone(text, target(task), !task.done),
    result => ({ id: result.id, done: task.done, status: task.status }),
  )
}

async function undoLast($: any): Promise<void> {
  const notice: Notice | null = await read($, noticeA)
  const undo = notice?.undo
  if (!undo) return
  await act(
    $,
    () => 'Undone.',
    text => {
      let result = setDone(text, { id: undo.id }, undo.done)
      if (!undo.done && undo.status !== 'ready') result = setStatus(result.text, { id: result.id }, undo.status as Status)
      return result
    },
  )
}

async function startTask($: any, task: Task): Promise<void> {
  const result = await act($, () => `Started: ${task.title}`, text => setStatus(text, target(task), 'in_progress'))
  if (result) await update($, momentA, m => ({ ...m, startedId: result.id }))
}

async function stopTask($: any, task: Task): Promise<void> {
  const result = await act($, () => `Paused: ${task.title}`, text => setStatus(text, target(task), 'ready'))
  if (result) await update($, momentA, m => ({ ...m, startedId: null }))
}

async function finishTask($: any, task: Task): Promise<void> {
  const result = await toggleDone($, task)
  if (!result) return
  await update($, momentA, m => ({ ...m, startedId: m.startedId === task.id || m.startedId === result.id ? null : m.startedId }))
}

async function cycleOwner($: any, task: Task): Promise<void> {
  const owner = NEXT_OWNER[task.owner]
  await act($, () => `Owner: ${OWNER_LABEL[owner]}`, text => setOwner(text, target(task), owner))
}

async function deleteTask($: any, task: Task): Promise<void> {
  const result = await act($, () => `Deleted: ${task.title}`, text => removeTask(text, target(task)))
  if (result) await update($, viewA, v => ({ ...v, selectedId: null, confirmDeleteId: null }))
}

async function renameTask($: any, task: Task, title: string): Promise<void> {
  const result = await act($, () => 'Renamed.', text => setTitle(text, target(task), title))
  if (result) await update($, viewA, v => ({ ...v, mode: 'list' as const, selectedId: result.id }))
}

async function quickAdd($: any, raw: string): Promise<EditResult | undefined> {
  const { title, owner } = parseQuickAdd(raw)
  return act($, () => `Added for ${OWNER_LABEL[owner]}: ${title.trim()}`, text => addTask(text, { title, owner }))
}

async function selectTask($: any, id: string): Promise<void> {
  await update($, viewA, v => ({
    ...v,
    selectedId: v.selectedId === id ? null : id,
    mode: 'list' as const,
    confirmDeleteId: null,
  }))
}

async function setFilter($: any, filter: Filter): Promise<void> {
  await update($, viewA, v => ({ ...v, filter, selectedId: null, confirmDeleteId: null }))
}

async function toggleHideDone($: any): Promise<void> {
  const view = await update($, viewA, v => ({ ...v, hideDone: !v.hideDone }))
  await $.store.set('hideDone', (view as ViewState).hideDone)
}

async function openPane($: any): Promise<boolean> {
  const { isPlaced } = await $.ui.open({ id: PANE, title: 'StayOn', columns: 46 })
  return isPlaced
}

/** Opens the pane unasked only when the project already keeps a task file. */
async function autoOpen($: any): Promise<void> {
  const file: FileView = await read($, fileA)
  if (!opts.openOnStart || file.status !== 'ok') return
  try {
    await openPane($)
  } catch {
    // No surface to draw on after all: /stayon opens it later.
  }
}

// ---------------------------------------------------------------------------
// Moments: the suggestion while Claude works, and the cue when it is done

async function suggestionsAllowed($: any): Promise<boolean> {
  if (!opts.suggestions) return false
  const until = Number((await $.store.get('snoozeUntil')) ?? 0)
  return until <= (await $.clock.now())
}

async function revealMoment($: any, turnId: string): Promise<void> {
  const agent = await read($, agentA)
  const moment: MomentState = await read($, momentA)
  if (agent.phase !== 'working' || agent.turnId !== turnId || moment.turnId !== turnId || moment.revealed) return
  if (!(await suggestionsAllowed($))) return
  await loadQuietly($)
  const pick = nextSuggestion((await taskFile($)).tasks, [])
  await update($, momentA, m => ({ ...m, revealed: true, currentId: pick?.id ?? null, shown: pick ? [pick.id] : [] }))
}

async function anotherTask($: any): Promise<void> {
  const moment: MomentState = await read($, momentA)
  const pick = nextSuggestion((await taskFile($)).tasks, moment.shown)
  await update($, momentA, m => ({ ...m, currentId: pick?.id ?? null, shown: pick ? [...m.shown, pick.id] : m.shown }))
}

async function momentDone($: any): Promise<void> {
  const moment: MomentState = await read($, momentA)
  const task = await findTask($, moment.currentId)
  if (!task) return anotherTask($)
  const result = await toggleDone($, task)
  if (result) await update($, momentA, m => ({ ...m, shown: [...m.shown, result.id] }))
  await anotherTask($)
}

async function momentStart($: any): Promise<void> {
  const moment: MomentState = await read($, momentA)
  const task = await findTask($, moment.currentId)
  if (task) await startTask($, task)
}

async function snooze($: any): Promise<void> {
  await $.store.set('snoozeUntil', (await $.clock.now()) + SNOOZE_MS)
  await update($, momentA, m => ({ ...m, dismissed: true }))
  await notify($, 'Suggestions snoozed for 30 minutes. /stayon resume turns them back on.')
}

async function dispatchAgent($: any, event: AgentEvent): Promise<void> {
  const before = await read($, agentA)
  const after = reduceAgent(before, event)
  if (after !== before) await update($, agentA, () => after)
}

async function onMainTurnStart($: any, turnId: string): Promise<void> {
  await dispatchAgent($, { type: 'turn_start', turnId, at: await $.clock.now() })
  await update($, momentA, m => ({
    turnId,
    revealed: false,
    dismissed: false,
    currentId: null,
    shown: [],
    startedId: m.startedId,
  }))
  await setCue($, { visible: false })
  $.clock.after(Math.round(opts.suggestDelaySeconds * 1000), () => {
    void revealMoment($, turnId).catch(() => undefined)
  })
}

async function onMainTurnEnd($: any, e: { turnId: string; reason: string; durationMs: number }): Promise<void> {
  const reason = e.reason as 'answer' | 'aborted' | 'refusal' | 'error'
  await dispatchAgent($, { type: 'turn_end', turnId: e.turnId, reason, durationMs: e.durationMs, at: await $.clock.now() })
  // An interrupt means the person is already here; a quick turn needs no cue.
  const isWorthACue = reason !== 'aborted' && e.durationMs >= opts.suggestDelaySeconds * 1000
  await setCue($, { visible: isWorthACue })
  if (reason !== 'aborted' && opts.notifyAfterSeconds > 0 && e.durationMs >= opts.notifyAfterSeconds * 1000) {
    await $.ui.notify(`Claude is ready after ${formatDuration(e.durationMs)}.`, { title: 'StayOn' }).catch(() => undefined)
  }
  await loadQuietly($)
}

async function hideCue($: any): Promise<void> {
  await setCue($, { visible: false })
}

// ---------------------------------------------------------------------------
// The slash command and Claude's tool

function summarize(file: TaskFile, fileView: FileView): string {
  if (fileView.status === 'missing') return `No task file yet (${fileView.path}). Add one with: /stayon add <task>`
  if (fileView.status === 'error') return `Cannot read ${fileView.path}: ${fileView.error}`
  if (file.tasks.length === 0) return `No tasks in ${fileView.path}.`
  const done = file.tasks.filter(t => t.done).length
  const lines = file.tasks.map(
    t => `${checkGlyph(t)} ${t.title}  (${t.hasId ? t.id : 'no id'} · ${OWNER_LABEL[t.owner]} · ${STATUS_LABEL[t.status]})`,
  )
  return [`${done}/${file.tasks.length} done · ${fileView.path}`, ...lines].join('\n')
}

const HELP = [
  '/stayon               open the StayOn pane',
  '/stayon list          print the tasks',
  '/stayon add <task>    add a task for you ("claude: <task>" for Claude)',
  '/stayon done <id>     mark a task done',
  '/stayon snooze        pause suggestions for 30 minutes',
  '/stayon resume        turn suggestions back on',
].join('\n')

async function runCommand($: any, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = args.trim().slice(verb.length).trim()
  switch (verb.toLowerCase()) {
    case '':
    case 'open': {
      await load($, true)
      return (await openPane($)) ? 'StayOn pane opened.' : summarize(await taskFile($), await read($, fileA))
    }
    case 'list':
    case 'ls':
      await load($, true)
      return summarize(await taskFile($), await read($, fileA))
    case 'add': {
      if (arg === '') return 'Usage: /stayon add <task>'
      const result = await quickAdd($, arg)
      const notice: Notice | null = await read($, noticeA)
      return result ? `${notice?.text ?? 'Added.'} (${result.id})` : (notice?.text ?? 'Nothing changed.')
    }
    case 'done':
    case 'reopen': {
      await load($, true)
      const id = rest[0] ?? ''
      const task = (await taskFile($)).tasks.find(t => t.id.toLowerCase() === id.toLowerCase())
      if (!task) return `No task with id "${id}". Try /stayon list.`
      if (task.done === (verb.toLowerCase() === 'done')) return `Already ${task.done ? 'done' : 'open'}: ${task.title}`
      await toggleDone($, task)
      return ((await read($, noticeA)) as Notice | null)?.text ?? 'Updated.'
    }
    case 'snooze':
      await snooze($)
      return 'Suggestions snoozed for 30 minutes.'
    case 'resume':
      await $.store.set('snoozeUntil', 0)
      return 'Suggestions are on.'
    case 'refresh':
      await load($, true)
      return summarize(await taskFile($), await read($, fileA))
    default:
      return HELP
  }
}

const TOOL_DESCRIPTION = [
  "Read and update this project's task list (TASKS.md), which the user also sees and edits in the StayOn pane.",
  'action "list": show all tasks with ids, owners and statuses.',
  'action "add": record a task only when the user explicitly asks for it or commits to it; give "title" and "owner" (human, agent or either). Never turn brainstorming or examples into tasks.',
  'action "update": change a task\'s "status" by "id" (ready, in_progress, blocked, needs_review, done, cancelled), or its "owner".',
  'Mark a task done only when it is verifiably complete. Human-owned tasks cannot be marked done by you; they become needs_review for the user to confirm.',
].join(' ')

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'add', 'update'] },
    id: { type: 'string', description: 'Task id, e.g. T-003 (update only)' },
    title: { type: 'string', description: 'Task title (add only)' },
    owner: { type: 'string', enum: ['human', 'agent', 'either'] },
    status: { type: 'string', enum: ['ready', 'in_progress', 'blocked', 'needs_review', 'done', 'cancelled'] },
  },
  required: ['action'],
  additionalProperties: false,
}

type ToolInput = { action?: string; id?: string; title?: string; owner?: string; status?: string }

const OWNERS: readonly string[] = ['human', 'agent', 'either']
const STATUSES: readonly string[] = ['ready', 'in_progress', 'blocked', 'needs_review', 'done', 'cancelled']

async function answerTool($: any, input: ToolInput): Promise<string> {
  await load($, true)
  const fileView: FileView = await read($, fileA)
  if (fileView.status === 'error') return `Nothing changed: ${fileView.path} could not be read (${fileView.error}).`

  const finish = async (what: string) => {
    await load($, true)
    return `${what}\n\n${summarize(await taskFile($), await read($, fileA))}`
  }

  if (input.action === 'list') return summarize(await taskFile($), fileView)

  if (input.action === 'add') {
    const owner = OWNERS.includes(input.owner ?? '') ? (input.owner as Owner) : 'either'
    const result = await mutate($, text => addTask(text, { title: input.title ?? '', owner }))
    return finish(`Added ${result.id}.`)
  }

  if (input.action === 'update') {
    const task = (await taskFile($)).tasks.find(t => t.id === input.id)
    if (!task) return `No task with id "${input.id ?? ''}". Use action "list" to see ids.`
    const notes: string[] = []
    let result: EditResult | undefined
    if (input.owner !== undefined) {
      if (!OWNERS.includes(input.owner)) return `Unknown owner "${input.owner}".`
      result = await mutate($, text => setOwner(text, target(task), input.owner as Owner))
      notes.push(`owner → ${input.owner}`)
    }
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status)) return `Unknown status "${input.status}".`
      let status = input.status as Status
      if (status === 'done' && task.owner === 'human') {
        status = 'needs_review'
        notes.push('human-owned, so set to needs_review for the user to confirm')
      }
      const id = result?.id ?? task.id
      result = await mutate($, text => setStatus(text, { id, title: task.title }, status))
      notes.push(`status → ${status}`)
    }
    if (!result) return 'Nothing to update: give "status" or "owner".'
    return finish(`Updated ${result.id}: ${notes.join('; ')}.`)
  }

  return 'Unknown action. Use "list", "add" or "update".'
}

// ---------------------------------------------------------------------------
// Registration

export const register: Register = (on, options) => {
  opts = readOptions(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Project tasks (TASKS.md) and what to do while Claude works',
      argumentHint: '[list | add <task> | done <id> | snooze | resume]',
    })
    await $.tool.register({ name: 'tasks', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })

    const hideDone = (await $.store.get('hideDone')) === true
    await update($, viewA, v => ({ ...v, hideDone }))
    await loadQuietly($)
    $.clock.every(POLL_MS, () => {
      void loadQuietly($)
    })

    // A plain `-p` run has no surface to draw on; the desktop app attaches one later.
    if ((await $.session.surfaces()).length > 0) await autoOpen($)

    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    await autoOpen($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await dispatchAgent($, { type: 'reset', at: await $.clock.now() })
      await hideCue($)
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await runCommand($, e.args) })).catch(() => ({
    text: 'StayOn hit an error; see claude --debug.',
  }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    try {
      return { result: await answerTool($, e as unknown as ToolInput) }
    } catch (err) {
      const message = err instanceof TaskEditError ? err.message : errorText(err)
      return { result: `Nothing changed: ${message}` }
    }
  }).catch(() => ({ result: 'Nothing changed: StayOn hit an error.' }))

  // Any other tool: watch for edits to the task file, and for a permission
  // prompt having been answered. Never changes the call or its result.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (e.tool !== TOOL) {
      await dispatchAgent($, { type: 'resumed', at: await $.clock.now() })
      await loadQuietly($)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.Notification', async ($, e, next) => {
    if (/permission|elicitation/i.test(e.notification_type)) {
      await dispatchAgent($, { type: 'needs_user', at: await $.clock.now() })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await onMainTurnStart($, e.turnId)
    else await dispatchAgent($, { type: 'subagent_start' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await onMainTurnEnd($, e)
    else await dispatchAgent($, { type: 'subagent_end' })
    return result
  })

  // ---- The pane: the whole task list --------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const width = Math.max(20, e.props.bodyColumns)

    const fileView: FileView = await read($, fileA)
    const view: ViewState = await read($, viewA)
    const agent = await read($, agentA)
    const moment: MomentState = await read($, momentA)
    const notice: Notice | null = await read($, noticeA)
    const file = await taskFile($)
    const tasks = file.tasks
    const done = tasks.filter(t => t.done).length
    const shown = applyFilter(tasks, view.filter, view.hideDone).slice(0, MAX_ROWS)
    const selected = tasks.find(t => t.id === view.selectedId)

    const agentLine =
      agent.phase === 'working'
        ? `● Claude is working${agent.subagents > 0 ? ` · ${agent.subagents} subagent${agent.subagents === 1 ? '' : 's'}` : ''}`
        : agent.phase === 'needs_user'
          ? '● Claude needs you'
          : agent.phase === 'ready'
            ? '○ Claude is ready'
            : '○ Claude is idle'

    const started = tasks.find(t => t.id === moment.startedId && !t.done)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>Tasks </Text>
          <Text dimColor>
            {done}/{tasks.length} done {progressBar(done, tasks.length, Math.min(14, width - 22))}
          </Text>
        </Box>
        <Text dimColor>{agentLine}</Text>
        {started && <Text>▸ You're on: {truncate(started.title, width - 13)}</Text>}

        <Box flexDirection="row">
          {FILTERS.map(f => (
            <Button
              key={`filter-${f.id}`}
              plain
              variant={view.filter === f.id ? 'primary' : undefined}
              label={view.filter === f.id ? `[${f.label}]` : ` ${f.label} `}
              onPress={() => setFilter($, f.id)}
            />
          ))}
        </Box>

        {fileView.status === 'error' && (
          <Text color="red">Can't read the task file: {fileView.error}. StayOn won't write to it until it can.</Text>
        )}
        {file.duplicateIds.length > 0 && (
          <Text color="yellow">Duplicate ids {file.duplicateIds.join(', ')}: fix them in the file to edit those tasks.</Text>
        )}
        {fileView.status === 'missing' && <Text dimColor>No tasks yet. Add one below, or ask Claude to plan next steps.</Text>}
        {fileView.status === 'ok' && tasks.length === 0 && <Text dimColor>No tasks yet. Add one below.</Text>}
        {fileView.status === 'ok' && tasks.length > 0 && shown.length === 0 && <Text dimColor>Nothing in this view.</Text>}

        {shown.map(t => (
          <Box key={`row-${t.id}`} flexDirection="row">
            <Button key={`check-${t.id}`} plain label={checkGlyph(t)} onPress={() => toggleDone($, t)} />
            <Button key={`task-${t.id}`} plain onPress={() => selectTask($, t.id)}>
              {` ${truncate(t.title, Math.max(8, width - 14))} `}
              <Text dimColor={view.selectedId !== t.id}>{OWNER_LABEL[t.owner]}</Text>
            </Button>
          </Box>
        ))}

        {selected && view.mode === 'list' && (
          <Box flexDirection="column">
            <Text dimColor>
              {truncate(selected.title, width)} · {STATUS_LABEL[selected.status]} · {describeTask(selected)}
            </Text>
            {view.confirmDeleteId === selected.id ? (
              <Box flexDirection="row">
                <Button key="confirm-delete" label="Delete it" onPress={() => deleteTask($, selected)} />
                <Button
                  key="cancel-delete"
                  label="Keep"
                  onPress={() => update($, viewA, v => ({ ...v, confirmDeleteId: null }))}
                />
              </Box>
            ) : (
              <Box flexDirection="row">
                <Button key="sel-done" label={selected.done ? 'Reopen' : 'Done'} onPress={() => finishTask($, selected)} />
                {!selected.done && selected.status !== 'in_progress' && (
                  <Button key="sel-start" label="Start" onPress={() => startTask($, selected)} />
                )}
                {!selected.done && selected.status === 'in_progress' && (
                  <Button key="sel-stop" label="Pause" onPress={() => stopTask($, selected)} />
                )}
                <Button key="sel-owner" label={`→ ${OWNER_LABEL[NEXT_OWNER[selected.owner]]}`} onPress={() => cycleOwner($, selected)} />
                {Input && (
                  <Button key="sel-edit" label="Edit" onPress={() => update($, viewA, v => ({ ...v, mode: 'edit' as const }))} />
                )}
                <Button
                  key="sel-delete"
                  label="Delete"
                  onPress={() => update($, viewA, v => ({ ...v, confirmDeleteId: selected.id }))}
                />
              </Box>
            )}
          </Box>
        )}

        {Input && selected && view.mode === 'edit' ? (
          <Box flexDirection="column">
            <Input key="edit" label="Rename" value={selected.title} onSubmit={value => renameTask($, selected, value)} />
            <Button key="edit-cancel" label="Cancel" onPress={() => update($, viewA, v => ({ ...v, mode: 'list' as const }))} />
          </Box>
        ) : (
          Input &&
          fileView.status !== 'error' && (
            <Input key="add" placeholder='Add a task ("claude: …" for Claude)' onSubmit={value => quickAdd($, value)} />
          )
        )}

        {notice && (
          <Box flexDirection="row">
            <Text color={notice.isError ? 'red' : undefined} dimColor={!notice.isError}>
              {truncate(notice.text, width - (notice.undo ? 8 : 0))}
            </Text>
            {notice.undo && <Button key="undo" plain label=" [Undo]" onPress={() => undoLast($)} />}
          </Box>
        )}

        <Box flexDirection="row">
          <Button key="hide-done" plain label={view.hideDone ? '[Show done]' : '[Hide done]'} onPress={() => toggleHideDone($)} />
          <Button key="refresh" plain label=" [Refresh]" onPress={() => load($, true)} />
        </Box>
        <Text dimColor>{truncate(fileView.path, width)}</Text>
      </Box>
    )
  })

  // ---- The band above the prompt: one moment, or the return cue ------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const agent = await read($, agentA)
    const moment: MomentState = await read($, momentA)
    const cue: CueState = await read($, cueA)
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const isTight = e.props.maxRows < 4

    if (agent.phase === 'needs_user') {
      return <Text color="yellow">◆ Claude needs you: answer below, then it carries on.</Text>
    }

    if (agent.phase === 'working' && moment.revealed && !moment.dismissed) {
      const file = await taskFile($)
      const started = file.tasks.find(t => t.id === moment.startedId && !t.done)
      const current = file.tasks.find(t => t.id === moment.currentId)

      if (started) {
        return (
          <Box flexDirection="column">
            <Text dimColor>◆ Claude is working · you're on:</Text>
            <Text bold>{truncate(started.title, width)}</Text>
            <Box flexDirection="row">
              <Button key="m-finish" variant="primary" label="Mark done" onPress={() => finishTask($, started)} />
              <Button key="m-pause" label="Pause" onPress={() => stopTask($, started)} />
              <Button key="m-dismiss" role="dismiss" label="Hide" onPress={() => update($, momentA, m => ({ ...m, dismissed: true }))} />
            </Box>
          </Box>
        )
      }

      if (!current) {
        return (
          <Box flexDirection="row">
            <Text dimColor>{truncate("◆ Claude is working · you're caught up. Stay with Claude or take a short break. ", width - 20)}</Text>
            <Button key="m-snooze" plain label="[Snooze]" onPress={() => snooze($)} />
            <Button key="m-dismiss" plain role="dismiss" label=" [Hide]" onPress={() => update($, momentA, m => ({ ...m, dismissed: true }))} />
          </Box>
        )
      }

      const buttons = (
        <Box flexDirection="row">
          <Button key="m-start" variant="primary" label="Start" onPress={() => momentStart($)} />
          <Button key="m-done" label="Mark done" onPress={() => momentDone($)} />
          <Button key="m-another" label="Another task" onPress={() => anotherTask($)} />
          <Button key="m-dismiss" role="dismiss" label="Dismiss" onPress={() => update($, momentA, m => ({ ...m, dismissed: true }))} />
        </Box>
      )
      if (isTight) {
        return (
          <Box flexDirection="column">
            <Text>◆ Meanwhile: {truncate(current.title, width - 14)}</Text>
            {buttons}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Text dimColor>◆ Claude is working · meanwhile, you could:</Text>
          <Text bold>{truncate(current.title, width)}</Text>
          <Text dimColor>{describeTask(current)}</Text>
          {buttons}
        </Box>
      )
    }

    if (cue.visible && agent.phase === 'ready') {
      const file = await taskFile($)
      const started = file.tasks.find(t => t.id === moment.startedId && !t.done)
      const end = agent.lastEnd
      const headline =
        end?.reason === 'error' || end?.reason === 'refusal'
          ? "✓ Claude's turn ended with a problem: check the result."
          : `✓ Claude is ready${end ? ` (${formatDuration(end.durationMs)})` : ''}: review the result.`
      return (
        <Box flexDirection="column">
          <Text color="green">{truncate(headline, width)}</Text>
          {started && !isTight && <Text dimColor>You were on: {truncate(started.title, width - 14)}</Text>}
          <Box flexDirection="row">
            <Button key="c-return" variant="primary" label="Return to Claude" onPress={() => hideCue($)} />
            {started && <Button key="c-finish" label="Mark done" onPress={() => finishTask($, started)} />}
            <Button key="c-tasks" label="Tasks" onPress={() => openPane($)} />
            <Button key="c-dismiss" role="dismiss" label="Dismiss" onPress={() => hideCue($)} />
          </Box>
        </Box>
      )
    }

    return next(e)
  })
}
