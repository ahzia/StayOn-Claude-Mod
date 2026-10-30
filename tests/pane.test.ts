// SPDX-License-Identifier: MIT
// Phase 1: the task pane reads and writes TASKS.md.

import { expect, test } from 'claude-code/testing'

import { FILE, PANE, ROOT, textOf, world } from './world'

const START = [
  '# Tasks',
  '',
  '## Ready',
  '- [ ] Review auth copy <!-- stayon:id=T-001 -->',
  '  - Owner: human',
  '- [ ] Write login tests <!-- stayon:id=T-002 -->',
  '  - Owner: agent',
  '',
  '## Done',
  '- [x] Set up repo <!-- stayon:id=T-003 -->',
  '',
].join('\n')

const SURFACES = ['terminal', 'desktop'] as const

for (const surface of SURFACES) {
  test(`the pane lists tasks and checks them off on ${surface}`, async ($, on) => {
    const w = world(on, { [FILE]: START })
    await $.session.start({ cwd: ROOT } as never)
    expect(w.opened).toBe(1) // a project with a task file opens the pane

    const pane = await $.ui.mount({ ...PANE, surface })
    const drawn = textOf(await pane.drawn())
    expect(drawn).toContain('1/3 done')
    expect(drawn).toContain('Review auth copy')
    expect(drawn).toContain('Write login tests')

    await pane.press({ key: 'check-T-001' })
    expect(w.files.get(FILE)).toContain('- [x] Review auth copy <!-- stayon:id=T-001 -->')
    expect(textOf(await pane.drawn())).toContain('2/3 done')
    expect(textOf(await pane.drawn())).toContain('Done: Review auth copy')

    await pane.press({ key: 'undo' })
    expect(w.files.get(FILE)).toBe(START)
    await pane.unmount()
  })

  test(`adding from the input writes the file on ${surface}`, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: ROOT } as never)
    expect(w.opened).toBe(0) // no task file: the pane waits for /stayon

    const pane = await $.ui.mount({ ...PANE, surface })
    expect(textOf(await pane.drawn())).toContain('No tasks yet')

    await pane.input({ key: 'add', text: 'Check mobile navbar' })
    await pane.input({ key: 'add', text: 'claude: Add regression test' })
    const text = w.files.get(FILE)!
    expect(text.startsWith('# Tasks\n')).toBe(true)
    expect(text).toContain('- [ ] Check mobile navbar <!-- stayon:id=T-001 -->\n  - Owner: human')
    expect(text).toContain('- [ ] Add regression test <!-- stayon:id=T-002 -->\n  - Owner: agent')
    expect(textOf(await pane.drawn())).toContain('0/2 done')
    await pane.unmount()
  })
}

test('selecting a task offers start, owner, rename and a confirmed delete', async ($, on) => {
  const w = world(on, { [FILE]: START })
  await $.session.start({ cwd: ROOT } as never)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'task-T-001' })
  await pane.press({ key: 'sel-start' })
  expect(w.files.get(FILE)).toContain('  - Owner: human\n  - Status: in_progress')
  expect(textOf(await pane.drawn())).toContain("You're on: Review auth copy")

  await pane.press({ key: 'sel-owner' })
  expect(w.files.get(FILE)).toContain('- [ ] Review auth copy <!-- stayon:id=T-001 -->\n  - Owner: agent')

  await pane.press({ key: 'sel-edit' })
  await pane.input({ key: 'edit', text: 'Review auth error copy' })
  expect(w.files.get(FILE)).toContain('- [ ] Review auth error copy <!-- stayon:id=T-001 -->')

  await pane.press({ key: 'task-T-002' })
  await pane.press({ key: 'sel-delete' })
  expect(w.files.get(FILE)).toContain('Write login tests') // not yet: needs confirmation
  await pane.press({ key: 'cancel-delete' })
  await pane.press({ key: 'sel-delete' })
  await pane.press({ key: 'confirm-delete' })
  expect(w.files.get(FILE)).not.toContain('Write login tests')
  expect(w.files.get(FILE)).toContain('## Done\n- [x] Set up repo')
  await pane.unmount()
})

test('filters change the view, never the file', async ($, on) => {
  const w = world(on, { [FILE]: START })
  await $.session.start({ cwd: ROOT } as never)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await pane.press({ key: 'filter-mine' })
  let drawn = textOf(await pane.drawn())
  expect(drawn).toContain('Review auth copy')
  expect(drawn).not.toContain('Write login tests')

  await pane.press({ key: 'filter-claude' })
  drawn = textOf(await pane.drawn())
  expect(drawn).toContain('Write login tests')
  expect(drawn).not.toContain('Review auth copy')

  await pane.press({ key: 'filter-done' })
  expect(textOf(await pane.drawn())).toContain('Set up repo')

  await pane.press({ key: 'filter-all' })
  await pane.press({ key: 'hide-done' })
  expect(textOf(await pane.drawn())).not.toContain('Set up repo')
  expect(w.writes).toBe(0)
  await pane.unmount()
})

test('edits made outside StayOn show up without a click', async ($, on) => {
  const w = world(on, { [FILE]: START })
  await $.session.start({ cwd: ROOT } as never)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  w.edit(FILE, `${START}- [ ] Added by hand\n`)
  await w.clock.advance(3000)
  expect(textOf(await pane.drawn())).toContain('Added by hand')

  // Claude editing the file through a tool is picked up right after the call.
  w.edit(FILE, START.replace('Write login tests', 'Write signup tests'))
  await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'a', new_string: 'b' } as never)
  expect(textOf(await pane.drawn())).toContain('Write signup tests')
  await pane.unmount()
})

test('a file that cannot be read is never written', async ($, on) => {
  const w = world(on, { [FILE]: START })
  await $.session.start({ cwd: ROOT } as never)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })

  w.failReads = true
  w.edit(FILE, `${START}- [ ] newer line\n`)
  await w.clock.advance(3000)
  expect(textOf(await pane.drawn())).toContain("Can't read the task file")

  await pane.press({ key: 'check-T-001' })
  expect(w.writes).toBe(0)
  expect(w.files.get(FILE)).toContain('newer line')
  expect(textOf(await pane.drawn())).toContain('Could not update the task file')
  await pane.unmount()
})

test('/stayon add, list and done work without the pane', async ($, on) => {
  const w = world(on, { [FILE]: START })
  await $.session.start({ cwd: ROOT } as never)

  const added = await $.command.run({ command: 'stayon', args: 'add claude: Update docs' } as never)
  expect(JSON.stringify(added)).toContain('T-004')
  expect(w.files.get(FILE)).toContain('- [ ] Update docs <!-- stayon:id=T-004 -->\n  - Owner: agent')

  const done = await $.command.run({ command: 'stayon', args: 'done T-001' } as never)
  expect(JSON.stringify(done)).toContain('Done: Review auth copy')

  const list = JSON.stringify(await $.command.run({ command: 'stayon', args: 'list' } as never))
  expect(list).toContain('2/4 done')
  expect(list).toContain('Update docs')
})

test('the .stayon/TASKS.md location is adopted when it is the only file', async ($, on) => {
  const alt = `${ROOT}/.stayon/TASKS.md`
  const w = world(on, { [alt]: '- [ ] Lives in .stayon <!-- stayon:id=T-001 -->\n' })
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'stayon', args: 'add Second' } as never)
  expect(w.files.get(alt)).toContain('Second')
  expect(w.files.has(FILE)).toBe(false)
})
