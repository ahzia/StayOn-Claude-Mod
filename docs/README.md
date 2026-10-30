# StayOn docs

| Doc | What it holds |
| --- | --- |
| [roadmap.md](roadmap.md) | Phases, gates and current status of v0.1 |
| [architecture.md](architecture.md) | Module boundaries and the ports that keep agents, task stores and activities replaceable |
| [task-file-format.md](task-file-format.md) | The `TASKS.md` format StayOn reads and writes (draft) |
| [mod-api-notes.md](mod-api-notes.md) | Facts about the Claude Code Mod API **verified on a real build**, with the version |
| [decisions/](decisions/) | Short architecture decision records (ADRs) |

Rules for these docs:

- Write down what was **verified**, and on which Claude Code version. Mark anything unverified as such.
- One decision per ADR; never rewrite an accepted ADR, supersede it with a new one.
- Keep the roadmap's status column current when a phase gate passes.
