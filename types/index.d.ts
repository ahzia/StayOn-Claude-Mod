// SPDX-License-Identifier: MIT
// The $.state contract of the StayOn mod: every session value a drawing reads.
// Tasks themselves live in TASKS.md; these are views of it and UI state.

export type AgentPhase = 'idle' | 'working' | 'needs_user' | 'ready'
export type TurnEndReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type AgentState = {
  phase: AgentPhase
  /** Epoch ms of the last phase change. */
  since: number
  /** The main turn in flight (or the last one), when known. */
  turnId?: string
  /** Subagent turns running under the main turn. */
  subagents: number
  /** How the last main turn ended. */
  lastEnd?: { reason: TurnEndReason; durationMs: number }
}

/** The task file as last read. `text` is only meaningful when `status` is `ok`. */
export type FileView = {
  status: 'loading' | 'ok' | 'missing' | 'error'
  /** Absolute path of the task file in use. */
  path: string
  text: string
  mtimeMs: number
  size: number
  error?: string
}

export type Filter = 'all' | 'mine' | 'claude' | 'review' | 'done'

export type ViewState = {
  filter: Filter
  hideDone: boolean
  selectedId: string | null
  mode: 'list' | 'edit'
  confirmDeleteId: string | null
}

/** The "while Claude works" suggestion for the current main turn. */
export type MomentState = {
  turnId: string | null
  /** Shown once the turn has run past the configured delay. */
  revealed: boolean
  dismissed: boolean
  /** The suggested task, or null when the person is caught up. */
  currentId: string | null
  /** Ids suggested this turn, so "Another task" never repeats one. */
  shown: string[]
  /** A task the person pressed Start on; survives across turns. */
  startedId: string | null
}

export type CueState = { visible: boolean }

export type Undo = { id: string; done: boolean; status: string }
export type Notice = { text: string; isError: boolean; undo: Undo | null }

declare module 'claude-code' {
  interface PluginState {
    stayon: {
      agent: AgentState
      file: FileView
      view: ViewState
      moment: MomentState
      cue: CueState
      notice: Notice | null
    }
  }
}
