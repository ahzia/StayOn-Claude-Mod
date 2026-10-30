# Contributing to StayOn

Thanks for helping. StayOn is small on purpose; please keep changes focused.

## Setup

1. Install Claude Code 2.1.287+ and Node 20+.
2. `npm install`
3. `claude --plugin-dir .` to run a session with the mod loaded. Saving a file reloads it. Run with `--debug` to see hooks that were skipped and trees the engine refused.

## Before you open a pull request

```bash
npm run check
```

That runs `claude plugin validate .`, `tsc -p .` and `claude plugin test .`.
Type-checking needs the declarations Claude Code writes into
`.claude-plugin/types/` the first time it loads the mod, so load it once with
`claude --plugin-dir .` before your first `tsc` run.

Also:

- Add or update a test for behaviour you change (`tests/*.test.ts`, using `claude-code/testing`).
- Try the change in a real session; say in the PR which surface you tried (terminal, desktop).
- Update [docs/](docs/README.md) when you change a format, a decision or a verified API fact.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.

## Ground rules for the code

- Never block Claude: every hook ends in `next(e)` unless it deliberately answers for itself.
- Never lose user data: a failed read never leads to a write; keep Markdown you do not understand.
- No network calls and no new runtime dependencies without discussion.
- Keep logic in pure modules that are testable without the engine.
- Start every source file with `// SPDX-License-Identifier: MIT`.

## Reporting bugs

Open an issue with your Claude Code version (`claude --version`), surface, what you
did, what you expected, and the relevant lines from `claude --debug` if any.
Security problems: see [SECURITY.md](SECURITY.md).
