# 0001: TASKS.md is the source of truth

- Status: accepted
- Date: 2026-10-19

## Context

Tasks must survive new sessions, `/clear` and restarts, stay readable and editable
by hand, and work without an account. Claude Code's native task tools
(`TaskCreate`, `TaskUpdate`) describe the agent's current execution plan and are a
different thing from the human's list of commitments.

## Decision

The project's `TASKS.md` (default at the project root, optionally
`.stayon/TASKS.md`) is the only persistent task store in v0.1. Native task events
are treated as *signals* that may suggest changes, never as automatic writes.

## Consequences

- Git-friendly, diffable, editable by people, StayOn and Claude alike.
- StayOn must round-trip Markdown it does not understand and handle concurrent edits.
- A remote store can be added later behind the same task-store port.
