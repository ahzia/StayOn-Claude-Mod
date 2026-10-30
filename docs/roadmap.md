# Roadmap

StayOn's goal: **stay on track while AI works.** v0.1 is a Claude Code Mod with a
persistent `TASKS.md` checklist and one useful, human-owned suggestion while Claude
is busy. No backend, no account, no network.

Legend: **E** engine tests (`claude plugin test`), **H** headless run on the real
engine (`claude -p`), **I** interactive session checked by a person.

## v0.1 phases

| Phase | Scope | Gate | Status |
| --- | --- | --- | --- |
| 0. Preflight | `/stayon` pane with a button; main-turn busy tracking | A real button press is handled | ✅ E, I (2.1.303 terminal) |
| 1. Checklist | Find/create `TASKS.md` (or `.stayon/TASKS.md`); stable ids; pane with add, check, reopen, rename, owner, start/pause, delete with confirm, filters, hide done, undo; `/stayon list/add/done` | Two sessions share one list; edits persist both ways | ✅ E; ✅ H (`/stayon list`, `/stayon add` across separate runs); ⏳ I (pane) |
| 2. Moments | After a delay in a main turn, one ready human task: **Start**, **Mark done**, **Another task**, **Dismiss**, snooze; return cue with duration, "you were on"; notification for long turns; "Claude needs you" on permission prompts | A live multi-step prompt shows a suggestion; an action persists; the cue appears | ✅ E; ⏳ I |
| 3. Safety | Never write after a failed read; last good copy shown with an error; duplicate ids refused; id-less edits guarded by title; Claude's tool cannot close human tasks (→ needs review) | No silent data loss; no false completion | ✅ E; ✅ H (tool via a real model turn) |
| 4. Release | Public repo, screenshots, marketplace install, outside user test | A new user installs alone and keeps tasks across restarts | Not started |

## Next (v0.2 candidates)

- Suggest tasks from the current session ("Extract tasks" with preview), and map Claude's native `TaskCreate`/`TaskUpdate` to suggestions.
- Evidence-aware completion: **Confirm / Keep open / Open evidence**.
- Move done tasks under a `## Done` heading when the file uses one.
- "Continue with Claude": queue a task as the next prompt when Claude is idle.
- Opt-in `CLAUDE.md` snippet that tells Claude about `TASKS.md`.
- Check compatibility with the Anthropic Productivity plugin's `TASKS.md` layout.
- CI running validate + type-check + tests.

## Not in v0.1

Surveys, rewards and payouts; Supabase or any backend; Cursor/Codex adapters;
transcript mining across past sessions; a general-purpose todo service.
These stay possible through the ports in [architecture.md](architecture.md).
