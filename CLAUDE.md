# Working on StayOn

StayOn is a Claude Code Mod (function hooks plugin). Start with `docs/README.md`.

## Commands

- `claude plugin validate .` after every change to hooks or the manifest
- `claude plugin test .` runs `tests/*.test.ts`
- `npx tsc -p .` type-checks (needs `.claude-plugin/types/`, written when Claude Code loads the mod)

## Rules

- The generated declarations in `.claude-plugin/types/claude-code/index.d.ts` are the API authority. Grep them; do not guess signatures. Record newly verified facts in `docs/mod-api-notes.md` with the version.
- Hooks module code has no Node and no DOM: everything goes through `$`. No `import()`.
- Every `$.state` key must be declared in `types/index.d.ts`. Render hooks never write state.
- Main-loop logic checks `e.agentId === undefined`; subagent turns must not flip the busy phase.
- Never write `TASKS.md` after a failed read; preserve lines the parser does not understand.
- Keep pure logic (parsing, agent state, recommendation) out of `register.tsx` so it is testable.
- Do not claim a feature works until it ran in a real Claude Code session; update the roadmap status when a gate passes.
