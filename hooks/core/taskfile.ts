// SPDX-License-Identifier: MIT
// TASKS.md: parse and edit. Pure functions over text, no `$`.
//
// The file belongs to the person. Every edit changes only the lines of the task
// it targets; every other line, including Markdown StayOn does not understand,
// is kept byte for byte. See docs/task-file-format.md.

export type Owner = 'human' | 'agent' | 'either'
export type Status = 'ready' | 'in_progress' | 'blocked' | 'needs_review' | 'done' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high'

export type Task = {
  /** Stable id from `<!-- stayon:id=… -->`, or a transient `~<line>` key when the task has none yet. */
  id: string
  hasId: boolean
  title: string
  done: boolean
  status: Status
  owner: Owner
  priority?: Priority
  estimateMinutes?: number
  dependsOn: string[]
  /** The nearest heading above the task, without its #s. */
  section?: string
  /** Index of the task's checkbox line. */
  line: number
  /** Index one past the task's last metadata or note line. */
  end: number
}

export type TaskFile = {
  tasks: Task[]
  /** Ids that appear on more than one task; edits to them are refused. */
  duplicateIds: string[]
}

export class TaskEditError extends Error {}

const TASK_LINE = /^(\s*)([-*+]|\d+[.)]) \[( |x|X)\] (.*)$/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE = /^\s*(```|~~~)/
const ID_COMMENT = /\s*<!--\s*stayon:id=([A-Za-z0-9_-]+)\s*-->/
const META = /^(\s+)[-*+] ([A-Za-z][A-Za-z ]*?):\s*(.*)$/

const STATUSES: readonly Status[] = ['ready', 'in_progress', 'blocked', 'needs_review', 'done', 'cancelled']
const OWNERS: readonly Owner[] = ['human', 'agent', 'either']

/** Splits text into lines; `eol` is what joins them back. */
export function splitLines(text: string): { lines: string[]; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return { lines: text.split(/\r?\n/), eol }
}

function indentWidth(s: string): number {
  return s.replace(/\t/g, '    ').length
}

function normalizeStatus(raw: string): Status | undefined {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (v === 'todo' || v === 'open') return 'ready'
  if (v === 'review' || v === 'in_review') return 'needs_review'
  if (v === 'doing' || v === 'wip' || v === 'started') return 'in_progress'
  return (STATUSES as readonly string[]).includes(v) ? (v as Status) : undefined
}

function normalizeOwner(raw: string): Owner | undefined {
  const v = raw.trim().toLowerCase()
  if (v === 'me' || v === 'user' || v === 'you') return 'human'
  if (v === 'claude' || v === 'ai' || v === 'assistant') return 'agent'
  if (v === 'any' || v === 'both') return 'either'
  return (OWNERS as readonly string[]).includes(v) ? (v as Owner) : undefined
}

/** "3m", "5 min", "1h", "1.5 hours" → minutes. */
export function parseEstimate(raw: string): number | undefined {
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)?$/)
  if (!m) return undefined
  const n = Number(m[1])
  const isHours = m[2] !== undefined && m[2].startsWith('h')
  return Math.round(isHours ? n * 60 : n)
}

function sectionStatus(section: string | undefined): Status | undefined {
  if (!section) return undefined
  if (/in[ -]?progress|doing/i.test(section)) return 'in_progress'
  if (/blocked|waiting/i.test(section)) return 'blocked'
  if (/review/i.test(section)) return 'needs_review'
  return undefined
}

/** Parses tasks out of a Markdown file. Never throws. */
export function parseTaskFile(text: string): TaskFile {
  const { lines } = splitLines(text)
  const tasks: Task[] = []
  let inFence = false
  let section: string | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = line.match(HEADING)
    if (heading) {
      section = heading[2]
      continue
    }

    const m = line.match(TASK_LINE)
    if (!m) continue

    const taskIndent = indentWidth(m[1]!)
    const done = m[3] !== ' '
    let rest = m[4]!
    const idMatch = rest.match(ID_COMMENT)
    const id = idMatch?.[1]
    rest = rest.replace(ID_COMMENT, '').trim()

    // The task's block: following lines indented deeper that are not tasks themselves.
    let end = i + 1
    const meta: Record<string, string> = {}
    while (end < lines.length) {
      const next = lines[end]!
      if (next.trim() === '' || TASK_LINE.test(next) || FENCE.test(next)) break
      const lead = next.match(/^(\s*)/)![1]!
      if (indentWidth(lead) <= taskIndent) break
      const mm = next.match(META)
      if (mm) meta[mm[2]!.trim().toLowerCase()] = mm[3]!.trim()
      end++
    }

    const metaStatus = meta.status !== undefined ? normalizeStatus(meta.status) : undefined
    let status: Status
    if (done) status = metaStatus === 'cancelled' ? 'cancelled' : 'done'
    else if (metaStatus && metaStatus !== 'done') status = metaStatus
    else status = sectionStatus(section) ?? 'ready'

    const priority = meta.priority?.toLowerCase()
    const deps = meta['depends on'] ?? meta.depends ?? ''

    tasks.push({
      id: id ?? `~${i}`,
      hasId: id !== undefined,
      title: rest,
      done,
      status,
      owner: (meta.owner !== undefined ? normalizeOwner(meta.owner) : undefined) ?? 'either',
      priority: priority === 'low' || priority === 'medium' || priority === 'high' ? priority : undefined,
      estimateMinutes: meta.estimate !== undefined ? parseEstimate(meta.estimate) : undefined,
      dependsOn: deps
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(s => s !== '' && s.toLowerCase() !== 'none'),
      section,
      line: i,
      end,
    })
  }

  const seen = new Map<string, number>()
  for (const t of tasks) if (t.hasId) seen.set(t.id, (seen.get(t.id) ?? 0) + 1)
  const duplicateIds = [...seen].filter(([, n]) => n > 1).map(([id]) => id)

  return { tasks, duplicateIds }
}

// ---------------------------------------------------------------------------
// Editing

/** One line of plain text that is safe to put on a task line. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/<!--|-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export function nextId(file: TaskFile): string {
  let max = 0
  for (const t of file.tasks) {
    const m = t.id.match(/^T-(\d+)$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `T-${String(max + 1).padStart(3, '0')}`
}

/** A target: the task's id, and for an id-less task the title the caller saw (a concurrency guard). */
export type Target = { id: string; title?: string }

function locate(text: string, target: Target): { file: TaskFile; task: Task } {
  const file = parseTaskFile(text)
  if (file.duplicateIds.includes(target.id)) {
    throw new TaskEditError(`Task id ${target.id} appears more than once in the file; fix it by hand first.`)
  }
  const task = file.tasks.find(t => t.id === target.id)
  if (!task) throw new TaskEditError('That task is no longer in the file.')
  if (!task.hasId && target.title !== undefined && task.title !== target.title) {
    throw new TaskEditError('The file changed; that task moved. Refresh and try again.')
  }
  return { file, task }
}

function join(lines: string[], eol: string): string {
  return lines.join(eol)
}

/** Ensures the task line carries a stable id comment. */
function withId(line: string, id: string): string {
  if (ID_COMMENT.test(line)) return line
  return `${line.replace(/\s+$/, '')} <!-- stayon:id=${id} -->`
}

/** Sets (or adds) a `- Key: value` metadata line; `undefined` removes it. */
function setMeta(lines: string[], task: Task, key: string, value: string | undefined): Task {
  const taskLine = lines[task.line]!
  const childIndent = `${taskLine.match(/^(\s*)/)![1]}  `
  for (let j = task.line + 1; j < task.end; j++) {
    const mm = lines[j]!.match(META)
    if (mm && mm[2]!.trim().toLowerCase() === key.toLowerCase()) {
      if (value === undefined) {
        lines.splice(j, 1)
        return { ...task, end: task.end - 1 }
      }
      lines[j] = `${mm[1]}- ${mm[2]}: ${value}`
      return task
    }
  }
  if (value === undefined) return task
  lines.splice(task.end, 0, `${childIndent}- ${key}: ${value}`)
  return { ...task, end: task.end + 1 }
}

function prepare(text: string, target: Target) {
  const { lines, eol } = splitLines(text)
  const { file, task } = locate(text, target)
  const id = task.hasId ? task.id : nextId(file)
  lines[task.line] = withId(lines[task.line]!, id)
  return { lines, eol, task, id }
}

export type EditResult = { text: string; id: string }

export function setDone(text: string, target: Target, done: boolean): EditResult {
  const { lines, eol, task, id } = prepare(text, target)
  lines[task.line] = lines[task.line]!.replace(/\[( |x|X)\]/, done ? '[x]' : '[ ]')
  const hasStatus = lines.slice(task.line + 1, task.end).some(l => /^\s+[-*+] status:/i.test(l))
  if (hasStatus) setMeta(lines, task, 'Status', done ? 'done' : 'ready')
  return { text: join(lines, eol), id }
}

export function setStatus(text: string, target: Target, status: Status): EditResult {
  if (status === 'done') return setDone(text, target, true)
  const { lines, eol, task, id } = prepare(text, target)
  lines[task.line] = lines[task.line]!.replace(/\[( |x|X)\]/, status === 'cancelled' ? '[x]' : '[ ]')
  setMeta(lines, task, 'Status', status)
  return { text: join(lines, eol), id }
}

export function setOwner(text: string, target: Target, owner: Owner): EditResult {
  const { lines, eol, task, id } = prepare(text, target)
  setMeta(lines, task, 'Owner', owner)
  return { text: join(lines, eol), id }
}

export function setTitle(text: string, target: Target, title: string): EditResult {
  const clean = cleanTitle(title)
  if (clean === '') throw new TaskEditError('A task needs a title.')
  const { lines, eol, task, id } = prepare(text, target)
  const m = lines[task.line]!.match(TASK_LINE)!
  lines[task.line] = `${m[1]}${m[2]} [${m[3]}] ${clean} <!-- stayon:id=${id} -->`
  return { text: join(lines, eol), id }
}

export function removeTask(text: string, target: Target): EditResult {
  const { lines, eol } = splitLines(text)
  const { task } = locate(text, target)
  lines.splice(task.line, task.end - task.line)
  return { text: join(lines, eol), id: task.id }
}

export const NEW_FILE_HEADER = [
  '# Tasks',
  '',
  '<!-- Kept by StayOn (and by you). Edit freely: one "- [ ]" line per task;',
  '     indented "- Owner:", "- Status:", "- Estimate:" lines are optional. -->',
  '',
]

export type NewTask = { title: string; owner?: Owner; status?: Status; estimateMinutes?: number }

/** Adds a task under the first to-do section, after the last open task, or at the end. */
export function addTask(text: string, input: NewTask): EditResult {
  const title = cleanTitle(input.title)
  if (title === '') throw new TaskEditError('A task needs a title.')

  const isEmpty = text.trim() === ''
  const { lines, eol } = isEmpty ? { lines: [...NEW_FILE_HEADER], eol: '\n' } : splitLines(text)
  const file = parseTaskFile(lines.join('\n'))
  const id = nextId(file)

  const block = [`- [ ] ${title} <!-- stayon:id=${id} -->`, `  - Owner: ${input.owner ?? 'human'}`]
  if (input.status && input.status !== 'ready' && input.status !== 'done') block.push(`  - Status: ${input.status}`)
  if (input.estimateMinutes !== undefined) block.push(`  - Estimate: ${input.estimateMinutes}m`)

  const at = insertionPoint(lines, file)
  if (at === undefined) {
    // No tasks yet: append, separated by a blank line.
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
    lines.push('', ...block, '')
  } else {
    lines.splice(at, 0, ...block)
  }
  return { text: join(lines, eol), id }
}

function insertionPoint(lines: string[], file: TaskFile): number | undefined {
  const top = file.tasks.filter(t => lineIndent(lines[t.line]!) === 0)
  if (top.length === 0) return undefined
  const isTodoSection = (s?: string) => s !== undefined && /^(ready|to ?do|todo|backlog|tasks|next|open|up next)\b/i.test(s)
  const inTodo = top.filter(t => isTodoSection(t.section))
  const open = top.filter(t => !t.done)
  const anchor = inTodo.at(-1) ?? open.at(-1) ?? top.at(-1)!
  return anchor.end
}

function lineIndent(line: string): number {
  return indentWidth(line.match(/^(\s*)/)![1]!)
}
