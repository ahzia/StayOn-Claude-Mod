# TASKS.md format

StayOn reads any Markdown checklist and only adds what it needs. The parser and
editor are in [`hooks/core/taskfile.ts`](../hooks/core/taskfile.ts) and tested in
[`tests/taskfile.test.ts`](../tests/taskfile.test.ts).

```markdown
# Tasks

## Ready
- [ ] Review auth error messages <!-- stayon:id=T-002 -->
  - Owner: human
  - Estimate: 3m
  - Priority: high

## In progress
- [ ] Add login tests <!-- stayon:id=T-003 -->
  - Owner: agent
  - Depends on: T-001

## Done
- [x] Configure database <!-- stayon:id=T-001 -->
```

## Where the file is

1. The configured path, if set (Task file setting).
2. Otherwise `TASKS.md` at the project root if it exists, else `.stayon/TASKS.md` if that exists.
3. Otherwise `TASKS.md` at the project root, created on the first add.

StayOn never creates a second file next to an existing one.

## Tasks

- A task is a line `- [ ] title` or `- [x] title`. `*`, `+` and `1.` bullets work too. Indented tasks are tasks.
- Lines inside code fences are ignored.
- The checkbox means done (`[x]` or `[X]`).
- Indented `- Key: value` lines right under a task are its metadata:

| Key | Values | Default |
| --- | --- | --- |
| `Owner` | `human` (or `me`), `agent` (or `claude`), `either` | `either` |
| `Status` | `ready`, `in_progress`, `blocked`, `needs_review`, `done`, `cancelled` | from the heading (`In progress`, `Blocked`, `Review`), else `ready` |
| `Estimate` | `3m`, `5 min`, `1h`, `1.5 hours` | none |
| `Priority` | `low`, `medium`, `high` | none |
| `Depends on` | task ids, comma separated | none |

Other indented lines under a task are kept as notes.

## Ids

Ids live in an HTML comment (`<!-- stayon:id=T-007 -->`), so they survive renames and
are invisible when rendered. A task without one gets the next free `T-###` the first
time StayOn edits it. An edit to an id-less task first checks that its title is
unchanged, so a moved line is never mistaken for another. Two tasks with the same id
are reported and neither can be edited until the file is fixed.

## What StayOn writes

- Only the lines of the task it edits: the checkbox, the title, or one metadata line (updated in place, or added at the end of the task's block).
- A new task goes after the last task under the first to-do heading (`Ready`, `Todo`, `Backlog`, `Next`, ...), else after the last open task, else at the end.
- Line endings (LF or CRLF) are kept.
- Nothing is written after a read that failed.
