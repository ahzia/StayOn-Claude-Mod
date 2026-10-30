// SPDX-License-Identifier: MIT
// TASKS.md parsing and editing: pure, no engine needed.

import { expect, test } from 'claude-code/testing'

import {
  addTask,
  parseEstimate,
  parseTaskFile,
  removeTask,
  setDone,
  setOwner,
  setStatus,
  setTitle,
  TaskEditError,
} from '../hooks/core/taskfile'

const SAMPLE = [
  '# Tasks',
  '',
  'Some notes the person wrote. Keep me.',
  '',
  '## Ready',
  '- [ ] Review auth copy <!-- stayon:id=T-002 -->',
  '  - Owner: human',
  '  - Estimate: 3m',
  '- [ ] Write login tests <!-- stayon:id=T-003 -->',
  '  - Owner: agent',
  '  - Depends on: T-001',
  '',
  '```md',
  '- [ ] not a task, inside a fence',
  '```',
  '',
  '## In progress',
  '* [ ] Plain task with no id',
  '',
  '## Done',
  '- [x] Configure database <!-- stayon:id=T-001 -->',
  '',
].join('\n')

test('parses tasks, metadata, sections and fences', () => {
  const { tasks, duplicateIds } = parseTaskFile(SAMPLE)
  expect(duplicateIds).toEqual([])
  expect(tasks.map(t => t.title)).toEqual([
    'Review auth copy',
    'Write login tests',
    'Plain task with no id',
    'Configure database',
  ])
  const [review, tests, plain, db] = tasks
  expect(review!.owner).toBe('human')
  expect(review!.estimateMinutes).toBe(3)
  expect(review!.status).toBe('ready')
  expect(tests!.owner).toBe('agent')
  expect(tests!.dependsOn).toEqual(['T-001'])
  expect(plain!.hasId).toBe(false)
  expect(plain!.status).toBe('in_progress') // from its section heading
  expect(plain!.owner).toBe('either')
  expect(db!.done).toBe(true)
  expect(db!.status).toBe('done')
})

test('handles empty, CRLF and odd input without throwing', () => {
  expect(parseTaskFile('').tasks).toEqual([])
  expect(parseTaskFile('just prose\n\n').tasks).toEqual([])
  const crlf = '- [ ] A <!-- stayon:id=T-001 -->\r\n- [X] B\r\n'
  const parsed = parseTaskFile(crlf)
  expect(parsed.tasks.map(t => [t.title, t.done])).toEqual([['A', false], ['B', true]])
  const edited = setDone(crlf, { id: 'T-001' }, true).text
  expect(edited).toBe('- [x] A <!-- stayon:id=T-001 -->\r\n- [X] B\r\n')
  expect(parseTaskFile('- [ ] Ünïcödé 任务 🚀').tasks[0]!.title).toBe('Ünïcödé 任务 🚀')
})

test('reports duplicate ids and refuses to edit them', () => {
  const dup = '- [ ] A <!-- stayon:id=T-001 -->\n- [ ] B <!-- stayon:id=T-001 -->\n'
  expect(parseTaskFile(dup).duplicateIds).toEqual(['T-001'])
  expect(() => setDone(dup, { id: 'T-001' }, true)).toThrow(TaskEditError)
})

test('checking a task changes only its own line', () => {
  const out = setDone(SAMPLE, { id: 'T-002' }, true).text
  const before = SAMPLE.split('\n')
  const after = out.split('\n')
  expect(after.length).toBe(before.length)
  const changed = after.map((l, i) => (l === before[i] ? null : i)).filter(i => i !== null)
  expect(changed).toEqual([5])
  expect(after[5]).toBe('- [x] Review auth copy <!-- stayon:id=T-002 -->')
  expect(setDone(out, { id: 'T-002' }, false).text).toBe(SAMPLE)
})

test('an id-less task gets an id on its first edit, guarded by its title', () => {
  const { tasks } = parseTaskFile(SAMPLE)
  const plain = tasks.find(t => !t.hasId)!
  const { text, id } = setDone(SAMPLE, { id: plain.id, title: plain.title }, true)
  expect(id).toBe('T-004')
  expect(text).toContain('* [x] Plain task with no id <!-- stayon:id=T-004 -->')
  expect(() => setDone(SAMPLE, { id: plain.id, title: 'Something else' }, true)).toThrow(TaskEditError)
})

test('status, owner and title edits keep the rest of the block', () => {
  let text = setStatus(SAMPLE, { id: 'T-002' }, 'in_progress').text
  expect(text).toContain('  - Owner: human\n  - Estimate: 3m\n  - Status: in_progress\n')
  expect(parseTaskFile(text).tasks[0]!.status).toBe('in_progress')

  text = setStatus(text, { id: 'T-002' }, 'done').text
  const t = parseTaskFile(text).tasks[0]!
  expect([t.done, t.status]).toEqual([true, 'done'])
  expect(text).toContain('  - Status: done')

  text = setOwner(text, { id: 'T-003' }, 'human').text
  expect(parseTaskFile(text).tasks[1]!.owner).toBe('human')

  text = setTitle(text, { id: 'T-003' }, '  Write   login\ntests  <!-- x --> ').text
  expect(text).toContain('- [ ] Write login tests x <!-- stayon:id=T-003 -->')
  expect(() => setTitle(text, { id: 'T-003' }, '   ')).toThrow(TaskEditError)
  expect(text).toContain('Some notes the person wrote. Keep me.')
  expect(text).toContain('- [ ] not a task, inside a fence')
})

test('removing a task removes exactly its block', () => {
  const out = removeTask(SAMPLE, { id: 'T-003' }).text
  expect(out).not.toContain('Write login tests')
  expect(out).not.toContain('Depends on: T-001')
  expect(out).toContain('  - Estimate: 3m\n\n```md')
  expect(() => removeTask(out, { id: 'T-003' })).toThrow(TaskEditError)
})

test('adding goes under the to-do section, or creates the file', () => {
  const added = addTask(SAMPLE, { title: 'Check mobile navbar', owner: 'human', estimateMinutes: 2 })
  expect(added.id).toBe('T-004')
  const lines = added.text.split('\n')
  const at = lines.indexOf('- [ ] Check mobile navbar <!-- stayon:id=T-004 -->')
  expect(lines[at - 1]).toBe('  - Depends on: T-001') // right after the last Ready task's block
  expect(lines[at + 1]).toBe('  - Owner: human')
  expect(lines[at + 2]).toBe('  - Estimate: 2m')

  const fresh = addTask('', { title: 'First task' })
  expect(fresh.text.startsWith('# Tasks\n')).toBe(true)
  expect(parseTaskFile(fresh.text).tasks.map(t => [t.id, t.title, t.owner])).toEqual([['T-001', 'First task', 'human']])

  const prose = addTask('# My notes\n\nhello\n', { title: 'X', owner: 'agent' })
  expect(prose.text).toBe('# My notes\n\nhello\n\n- [ ] X <!-- stayon:id=T-001 -->\n  - Owner: agent\n')
  expect(() => addTask(SAMPLE, { title: ' ' })).toThrow(TaskEditError)
})

test('estimates parse in minutes and hours', () => {
  expect(parseEstimate('3m')).toBe(3)
  expect(parseEstimate('5 min')).toBe(5)
  expect(parseEstimate('1h')).toBe(60)
  expect(parseEstimate('1.5 hours')).toBe(90)
  expect(parseEstimate('soon')).toBe(undefined)
})
