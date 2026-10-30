# StayOn for Claude Code

**Stay on track while AI works.** StayOn is a Claude Code Mod that keeps your
project's tasks in a plain `TASKS.md` file and shows them in a native pane. While
Claude is busy, it suggests one small thing *you* can do meanwhile. When Claude's
turn ends, it tells you so you can get back to it.

> **Status: v0.1 in development.** The checklist, suggestions, return cue and Claude's
> task tool work and are tested. See [docs/roadmap.md](docs/roadmap.md) for what is
> verified where.

## What it does

- **One list per project, across sessions.** Tasks live in `TASKS.md` at the project root. You, StayOn and Claude all read and write the same file, and it survives `/clear`, restarts and new sessions.
- **A native task pane** (`/stayon`): check off, add, rename, reassign (you / Claude / either), start, delete (with confirmation), filter (All, Mine, Claude, Review, Done), undo.
- **"Meanwhile, you could…"** Once a turn has run for a few seconds, one of *your* ready tasks appears above the prompt, with **Start**, **Mark done**, **Another task** and **Dismiss**. It never offers Claude's tasks, blocked tasks, tasks waiting on others, or anything longer than 30 minutes.
- **Back to Claude.** When a longer turn ends: *"Claude is ready (1m 12s): review the result."*, plus a desktop notification for turns over a minute. If you started a task, it reminds you where you were. A permission prompt shows *"Claude needs you"* instead.
- **Claude can keep the list too.** Claude gets a `tasks` tool to list, add and update tasks. It cannot mark *your* tasks done; those become **needs review** for you to confirm.

## Requirements

- Claude Code **2.1.287 or newer** (Mods are early access; developed on 2.1.303)
- The Claude Code CLI or desktop app. Mod panes may not render in IDE extensions.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install stayon --marketplace ahzia/StayOn-Claude-Mod
```

From a shell:

```bash
claude plugin install stayon --marketplace ahzia/StayOn-Claude-Mod
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ahzia/StayOn-Claude-Mod`, then **Add plugin**.

## Use

| Command | What it does |
| --- | --- |
| `/stayon` | Open the task pane |
| `/stayon list` | Print the tasks |
| `/stayon add <task>` | Add a task for you; `/stayon add claude: <task>` for Claude |
| `/stayon done <id>` | Mark a task done (ids look like `T-003`) |
| `/stayon snooze` / `resume` | Pause suggestions for 30 minutes / turn them back on |

In the pane's input, prefix a task with `claude:` to give it to Claude.

## The task file

```markdown
# Tasks

## Ready
- [ ] Review the login error messages <!-- stayon:id=T-001 -->
  - Owner: human
  - Estimate: 3m
- [ ] Add unit tests for the login form <!-- stayon:id=T-002 -->
  - Owner: agent
```

Any Markdown checklist works; StayOn only adds an id comment to tasks it edits and
never touches lines it does not understand. Details: [docs/task-file-format.md](docs/task-file-format.md).
To keep it out of the repo root, create `.stayon/TASKS.md` instead.

## Settings

In Claude Code's config menu, under **stayon**:

| Setting | Default | Meaning |
| --- | --- | --- |
| Task file | *(auto)* | Path relative to the project root |
| Suggest tasks while Claude works | on | Show the suggestion band |
| Suggestion delay (seconds) | 5 | How long a turn runs before a suggestion or ready cue appears |
| Notify after (seconds) | 60 | Desktop notification for turns at least this long; 0 is off |
| Open the pane on start | on | Open the pane when the project has a task file |

## Privacy

StayOn makes no network requests and needs no account. It reads and writes your
task file and keeps a few preferences in Claude Code's per-plugin store. Claude's
`tasks` tool is served by Claude Code itself on localhost. Uninstalling leaves your
`TASKS.md` where it is.

## Known limitations

- Marking a task done does not move it under a `## Done` heading; it stays where it is.
- "Claude needs you" relies on Claude Code's permission notification, which arrives a few seconds after the prompt appears. It does not run where an organization manages Claude Code.
- File changes made outside Claude Code are picked up within about 2.5 seconds (there is no file watcher API).

## Development

```bash
git clone https://github.com/ahzia/StayOn-Claude-Mod.git && cd StayOn-Claude-Mod
npm install            # TypeScript, for type-checking only
claude --plugin-dir .  # a session with the mod loaded; saving a file reloads it
npm run check          # validate + type-check + tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [docs](docs/README.md).

## Related

StayOn started as a Cursor extension that offered paid surveys while the Cursor Agent worked:
**[ahzia/StayOn](https://github.com/ahzia/StayOn)**. This Claude Code Mod is a fresh,
local-only take on the same idea (staying productive while AI works), starting with
project tasks. The two projects share no code.

## License

[MIT](LICENSE). StayOn is an independent project, not affiliated with or endorsed by Anthropic.
