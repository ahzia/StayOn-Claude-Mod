# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased] — 0.1.0

### Added

- `TASKS.md` parser and editor that changes only the lines of the task it edits, keeps unknown Markdown, assigns stable `T-###` ids, and refuses duplicate ids.
- Task pane (`/stayon`): progress, filters (All, Mine, Claude, Review, Done), check/reopen, add (`claude:` prefix for Claude's tasks), rename, owner, start/pause, delete with confirmation, hide done, undo.
- `/stayon list | add | done | snooze | resume`.
- Suggestion band while Claude works: one ready human task after a delay, with Start, Mark done, Another task, Dismiss and Snooze.
- Return cue when a longer turn ends, with the turn's duration and the task you started; desktop notification for long turns; "Claude needs you" on permission prompts.
- `mcp__stayon__tasks` tool for Claude: list, add, update; human-owned tasks become `needs_review` instead of done.
- Settings: task file path, suggestions on/off, suggestion delay, notification threshold, open pane on start.
- Picks up edits made by hand or by Claude (polling every 2.5 s and after each tool call).
- Engine tests (30) covering parsing, editing, the pane, moments, the cue and the tool.
- Project scaffolding: MIT license, docs, decision records.
