// SPDX-License-Identifier: MIT
// Phase 2: one suggestion while Claude works, and a cue when it is done.

import { expect, test } from 'claude-code/testing'

import { BAND, FILE, ROOT, textOf, world } from './world'

const TASKS = [
  '- [ ] Review error copy <!-- stayon:id=T-001 -->',
  '  - Owner: human',
  '  - Priority: high',
  '- [ ] Check mobile navbar <!-- stayon:id=T-002 -->',
  '  - Owner: human',
  '  - Estimate: 2m',
  '- [ ] Write the tests <!-- stayon:id=T-003 -->',
  '  - Owner: agent',
  '',
].join('\n')

const answer = (turnId: string, durationMs: number, extra: object = {}) =>
  ({ answer: 'ok', durationMs, isAborted: false, turnId, reason: 'answer', ...extra }) as never

test('a long turn reveals one human task, rotates, and marks done', async ($, on) => {
  const w = world(on, { [FILE]: TASKS })
  await $.session.start({ cwd: ROOT } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  void $.turn.start({ text: 'refactor', turnId: 't1' })
  await w.clock.settle()
  expect(textOf(await band.drawn())).not.toContain('meanwhile') // no flash on short turns

  await w.clock.advance(5000)
  let drawn = textOf(await band.drawn())
  expect(drawn).toContain('meanwhile, you could')
  expect(drawn).toContain('Review error copy') // high priority first
  expect(drawn).not.toContain('Write the tests') // Claude's own task is never offered

  await band.press({ key: 'm-another' })
  expect(textOf(await band.drawn())).toContain('Check mobile navbar')

  await band.press({ key: 'm-done' })
  expect(w.files.get(FILE)).toContain('- [x] Check mobile navbar <!-- stayon:id=T-002 -->')
  drawn = textOf(await band.drawn())
  expect(drawn).toContain("you're caught up")

  await band.press({ key: 'm-dismiss' })
  expect(textOf(await band.drawn())).not.toContain('caught up')
  await band.unmount()
})

test('Start keeps the task with you, through the ready cue', async ($, on) => {
  const w = world(on, { [FILE]: TASKS })
  await $.session.start({ cwd: ROOT } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })

  void $.turn.start({ text: 'build', turnId: 't1' })
  await w.clock.advance(5000)
  await band.press({ key: 'm-start' })
  expect(w.files.get(FILE)).toContain('  - Priority: high\n  - Status: in_progress')
  expect(textOf(await band.drawn())).toContain("you're on:")

  await $.turn.complete(answer('t1', 42_000))
  const drawn = textOf(await band.drawn())
  expect(drawn).toContain('Claude is ready (42s)')
  expect(drawn).toContain('You were on: Review error copy')

  await band.press({ key: 'c-finish' })
  expect(w.files.get(FILE)).toContain('- [x] Review error copy')
  await band.press({ key: 'c-return' })
  expect(textOf(await band.drawn())).not.toContain('Claude is ready')
  await band.unmount()
})

test('quick and interrupted turns show no cue; long turns notify', async ($, on) => {
  const w = world(on, { [FILE]: TASKS })
  await $.session.start({ cwd: ROOT } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete(answer('t1', 1200))
  expect(textOf(await band.drawn())).not.toContain('Claude is ready')

  await $.turn.start({ text: 'long', turnId: 't2' })
  await $.turn.complete(answer('t2', 30_000, { reason: 'aborted', isAborted: true }))
  expect(textOf(await band.drawn())).not.toContain('Claude is ready')

  await $.turn.start({ text: 'longer', turnId: 't3' })
  await $.turn.complete(answer('t3', 75_000))
  expect(textOf(await band.drawn())).toContain('Claude is ready (1m 15s)')
  expect(w.notifications).toEqual(['Claude is ready after 1m 15s.'])

  // The next prompt takes the cue down.
  await $.turn.start({ text: 'next', turnId: 't4' })
  expect(textOf(await band.drawn())).not.toContain('Claude is ready')
  await band.unmount()
})

test('subagent turns never end the main turn', async ($, on) => {
  const w = world(on, { [FILE]: TASKS })
  await $.session.start({ cwd: ROOT } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  void $.turn.start({ text: 'main', turnId: 't1' })
  await $.turn.start({ text: 'sub', turnId: 's1', agentId: 'a1' })
  await $.turn.complete(answer('s1', 20_000, { agentId: 'a1' }))
  await w.clock.advance(5000)
  expect(textOf(await band.drawn())).toContain('meanwhile') // still working
  expect(textOf(await band.drawn())).not.toContain('Claude is ready')
  await band.unmount()
})

test('a permission prompt switches the band to "Claude needs you"', async ($, on) => {
  const w = world(on, { [FILE]: TASKS })
  await $.session.start({ cwd: ROOT } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  void $.turn.start({ text: 'deploy', turnId: 't1' })
  await w.clock.advance(5000)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' } as never)
  expect(textOf(await band.drawn())).toContain('Claude needs you')

  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(textOf(await band.drawn())).toContain('meanwhile')
  await band.unmount()
})

test('snooze silences suggestions until resumed', async ($, on) => {
  const w = world(on, { [FILE]: '- [ ] Only human thing <!-- stayon:id=T-001 -->\n  - Owner: human\n' })
  await $.session.start({ cwd: ROOT } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await $.command.run({ command: 'stayon', args: 'snooze' } as never)
  void $.turn.start({ text: 'a', turnId: 't1' })
  await w.clock.advance(6000)
  expect(textOf(await band.drawn())).not.toContain('meanwhile')

  await $.command.run({ command: 'stayon', args: 'resume' } as never)
  void $.turn.start({ text: 'b', turnId: 't2' })
  await w.clock.advance(6000)
  expect(textOf(await band.drawn())).toContain('Only human thing')
  await band.unmount()
})

test("Claude's task tool lists, adds and updates, but cannot close human tasks", async ($, on) => {
  const w = world(on, { [FILE]: TASKS })
  await $.session.start({ cwd: ROOT } as never)
  const call = async (input: object) =>
    JSON.stringify(await $.tool.call({ tool: 'mcp__stayon__tasks', ...input } as never))

  expect(await call({ action: 'list' })).toContain('0/3 done')

  expect(await call({ action: 'add', title: 'Document the API', owner: 'agent' })).toContain('Added T-004')
  expect(w.files.get(FILE)).toContain('- [ ] Document the API <!-- stayon:id=T-004 -->\n  - Owner: agent')

  await call({ action: 'update', id: 'T-003', status: 'done' })
  expect(w.files.get(FILE)).toContain('- [x] Write the tests <!-- stayon:id=T-003 -->')

  const human = await call({ action: 'update', id: 'T-001', status: 'done' })
  expect(human).toContain('needs_review')
  expect(w.files.get(FILE)).toContain('- [ ] Review error copy <!-- stayon:id=T-001 -->')
  expect(w.files.get(FILE)).toContain('  - Status: needs_review')

  expect(await call({ action: 'update', id: 'T-999', status: 'done' })).toContain('No task with id')
  expect(await call({ action: 'add', title: '   ' })).toContain('Nothing changed')
})
