# Architecture

StayOn is an **agent-aware activity surface**. In v0.1 the only agent is Claude Code
and the only activity provider is the project's `TASKS.md`. Both sides stay
replaceable.

```
Claude Code events ──► agent state ──► activity coordinator ──► Mod UI (pane, band, toast)
                                              │
                                    activity providers
                                              │
                                   project tasks ──► task store ──► TASKS.md
```

## Modules

| Module | Responsibility | Uses `$`? |
| --- | --- | --- |
| `hooks/register.tsx` | Wires events, commands, Claude's tool, the task store (`load`, `mutate`) and the render hooks (pane, band) | yes, and the only file that does |
| `hooks/core/taskfile.ts` | Parse and edit `TASKS.md`; round-trips unknown Markdown | no |
| `hooks/core/agent.ts` | Reducer: `idle → working ⇄ needs_user → ready`, main vs subagent turns | no |
| `hooks/core/recommend.ts` | Which task to suggest, rotation, caught-up | no |
| `hooks/core/view.ts` | Filters, labels, progress bar, quick-add parsing | no |
| `types/index.d.ts` | The `$.state` contract | types only |

Every `$` call stays in `register.tsx` because `claude plugin validate` reads `$` calls
and state atoms from the module's source. The pure modules hold most of the logic and
are tested without the engine.

## Ports (contracts kept small on purpose)

- **Agent signals**: `TURN_START`, `TURN_END`, `NEEDS_USER` (when the API exposes it), `SESSION_START`, `SESSION_END`, from Claude Code's `turn.start` / `turn.complete` / `session.*` events. Subagent turns are counted but never flip the main phase.
- **Task store**: `load()` → `{ tasks, version }`, `apply(commands, expectedVersion)`. v0.1 implementation: the local Markdown file. Later: a remote store over MCP.
- **Activity provider**: `list(context)` → bounded activities. v0.1: project tasks only.
- **UI surface**: show tasks, show one moment, show a return cue.

## State and persistence

| Kind of state | Where |
| --- | --- |
| Tasks | `TASKS.md` in the project (source of truth) |
| Session UI state (agent phase, current suggestion, dismissed ids) | `$.state`, declared in `types/index.d.ts` |
| Per-user preferences (hide done, snooze) | `$.store` |

Module-level variables are lost on hot reload, so drawn state never lives there.

## Safety rules

- Every hook calls `next(e)`; StayOn never blocks, delays or denies Claude's work.
- A failed read never leads to a write. Only a missing file counts as an empty list.
- Writes re-read the file first and apply changes by stable task id; on a conflict, reload and retry rather than overwrite.
- Nothing leaves the machine in v0.1.
