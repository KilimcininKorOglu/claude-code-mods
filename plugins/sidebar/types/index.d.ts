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

/** How long a section stays: until the turn ends, or until the mod replaces or clears it. */
export type SidebarUntil = 'turn' | 'session'

export type SidebarSection = {
  /** The mod writing it, drawn in front of the title. */
  consumer: string
  /** Names the section inside that mod; a second `set` with the same key replaces it. */
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
  /** Drops one section; an unknown key is left alone. */
  clear(input: { consumer: string; key: string }): Promise<void>
  /** Whether the pane is open now. */
  isOpen(): Promise<boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    sidebar: Sidebar
  }
}
