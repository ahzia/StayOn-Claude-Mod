# Mod API notes

Facts StayOn relies on, each checked on a real build. The authority is always the
generated declarations in `.claude-plugin/types/claude-code/index.d.ts`; this file
is the map. Re-check after upgrading Claude Code.

Verified on **Claude Code 2.1.303** (types written by 2.1.299), October 2026.

## Lifecycle

- `turn.start` / `turn.complete` fire for the main loop **and** subagents; `e.agentId` is set only for subagents. Main-loop logic must check `e.agentId === undefined`.
- `turn.complete` has `reason` (`answer | aborted | refusal | error`), `durationMs` and `isAborted`.
- `session.start` fires once per load and again on every hot reload. `/clear` raises `session.end` with `reason: 'clear'` and **no** new `session.start`.
- There is no "permission prompt shown" event. StayOn uses the classic `Notification` hook (`on('classic.Notification')`, `notification_type` containing `permission` or `elicitation`), which arrives a few seconds after the prompt. `claude plugin validate` warns that classic events do not reach user-installed plugins where an organization manages Claude Code.
- A permission prompt is answered inside the tool call, so "resumed" is detected after `await next(e)` in a `tool.call` hook.
- `AbovePrompt` props include `isWorking`, `hasSurvey`, `maxRows` and `bodyColumns`.

## Files, storage, timers

- `$.fs` has `read/write/exists/stat/list` and no watcher. `stat` gives `mtimeMs` and `size`. StayOn polls `stat` every 2.5 s and after each tool call.
- `$.fs.read` rejects on a missing file and on other errors; StayOn treats only a missing file as empty.
- `$.store` is per plugin, across sessions, JSON values. `$.state` is per session, survives hot reloads and must be declared in the plugin's `types` contract.
- `$.clock.every` / `$.clock.after` run until cancelled or the module reloads; a reload drops them.

## Source scan rules (`claude plugin validate`)

- `read($, x)` / `update($, x, fn)` need `x` to be an `atom(...)` declared in the same file with literal `plugin` and `key`. A generic helper that takes the atom as a parameter is refused.
- Hooks on events that can refuse something (`tool.call`, `command.run`, classic events) are listed as gates; give observers `.catch(($, e, next) => next(e))` so they fail open.

## UI

- `$.ui.open({ id, title, columns? })` resolves `{ isPlaced }`; a `ui.render` hook on `{ component: 'Pane', requestId: id }` draws it. In a plain `-p` run `$.session.surfaces()` is empty and `$.ui.open` rejects with `no-surface` (logged as an ERROR), so check surfaces first. The desktop app attaches later (`session.attach`).
- `Button` and `Box` keep their `key` in the drawn tree; `Text` does not.
- `Input` has `value`, `placeholder`, `label`, `onSubmit`; the `mobile` surface has no `Input`.

## Tools

- `$.tool.register({ name, description, inputSchema, isDeferred: false })` lists `mcp__<plugin>__<name>`, served by Claude Code as a localhost MCP server. The tool's input fields arrive spread on `e` in the `tool.call` hook; answer with `{ result }`.
- In `-p` runs the tool needs `--allowedTools mcp__stayon__tasks` (or a permission rule).

## Slash commands headless

- `claude -p "/stayon list"` runs the command and prints `stayon: <text>`.

## userConfig

- `"userConfig": { "<field>": { "type": "string|number|boolean", "title", "description", "default" } }` is accepted; values arrive as `register`'s `options`, defaults filled in.

## Testing (`claude plugin test`)

- Nothing sits beneath the plugin: a test answers every engine event the plugin raises. `session.start`, `turn.*`, `tool.call`, `classic.*` and `ui.render` (must return a tree element, e.g. an empty `Box`) are answered with `on(event, hook)`.
- Nouns (`fs.read`, `session.root`, `ui.open`, ...) are answered with `on('<noun>.<method>', () => ({ value }))`; a hook that throws makes the call reject.
- `mock.clock(on)` gives `advance`, `settle`, `set`; `mock.store(on)` keeps an in-memory store.
- Test files can import the plugin's own modules (`../hooks/core/...`).
