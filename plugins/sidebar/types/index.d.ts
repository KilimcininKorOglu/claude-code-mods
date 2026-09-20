/**
 * `$.sidebar`, added by the sidebar plugin: one shared pane every other mod writes into.
 *
 * `set` answers whether the section was taken: `false` means the sidebar is closed (or the plugin is
 * not installed, where the call throws), so the caller keeps its own way of showing the same finding.
 */

/** One line of a section; `kind` colours it. */
export type SidebarLine = { text: string; kind?: 'ok' | 'warn' | 'dim' }

/** A button under a section: pressing it runs the slash command `/<command> <args>`. */
export type SidebarButton = { label: string; command: string; args?: string }

/**
 * How long a section stays.
 *
 * - `session`: it stands at the top of the pane until the mod replaces or clears it.
 * - `stream`: it joins the stream under the standing sections, newest first, and stays there until
 *   newer entries push it off the pane's last row. A second `set` with the same key adds an entry
 *   rather than replacing one, so the stream reads as a log.
 * - `turn`: it goes when the turn ends.
 */
export type SidebarUntil = 'turn' | 'session' | 'stream'

export type SidebarSection = {
  /** The mod writing it, drawn in front of the title. */
  consumer: string
  /** Names the section inside that mod; a second `set` with the same key replaces it, except in the stream. */
  key: string
  title: string
  lines: readonly SidebarLine[]
  buttons?: readonly SidebarButton[]
  until: SidebarUntil
  /** Lower comes first; 100 when absent. */
  order?: number
}

export type Sidebar = {
  /** Writes the section and draws it. `false`: the sidebar is closed and nothing was kept. */
  set(section: SidebarSection): Promise<boolean>
  /** Drops one section, and every stream entry of that key; an unknown key is left alone. */
  clear(input: { consumer: string; key: string }): Promise<void>
  /** Whether the pane is open now. */
  isOpen(): Promise<boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    sidebar: Sidebar
  }
}
