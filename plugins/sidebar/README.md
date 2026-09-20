# sidebar

A Claude Code Mod that opens one shared pane beside the transcript and draws what every other mod writes into it. There is one sidebar, not one pane per mod: a mod calls `$.sidebar.set(...)` with a section of lines and buttons, and this mod draws it.

## What it does

1. `/sidebar` opens the pane and `/sidebar off` closes it. The choice is kept in `$.store`, so a session started later opens the sidebar again by itself.
2. While it is open, any mod writes a section: `$.sidebar.set({ consumer, key, title, lines, buttons, until, order })` answers `true`. While it is closed nothing is kept and the call answers `false`, so the mod keeps showing its own transcript line or status line instead.
3. A section is drawn as a bold heading (`<consumer>: <title>`), its lines (`ok` green, `warn` yellow, `dim` faint) and its buttons. The pane has two parts: the standing sections at the top (`until: 'session'`, then `until: 'turn'`, each group by `order`, then consumer, then key), and the stream under them.
4. The stream is what `until: 'stream'` writes: a log of findings, newest first, right under the standing sections. An entry never replaces another, so the same mod and key twice reads as two entries. Nothing drops an entry at the turn's end: an entry leaves only when newer ones push it past the pane's last row. A taller terminal holds more of the stream, a shorter one less.
5. A button runs a slash command: pressing `[ stop ]` of `{ label: 'stop', command: 'bg-tasks', args: 'stop b1' }` runs `/bg-tasks stop b1` as the person would, and the command's first answer line shows at the foot of the pane. The mod that offers the button serves that command itself.
6. The three lifetimes: `session` stands at the top until the mod replaces or clears it, `stream` joins the log under it, `turn` goes when the turn ends.

## The API other mods use

Do **not** declare `"dependencies": ["sidebar"]` in `plugin.json`. A declared dependency is a hard one: the engine does not load your mod at all when the person has no sidebar installed (measured on 2.1.278). Call the API behind a guard instead, and your mod works with or without this one:

```ts
/** The finding the person reads: the sidebar while it is open, else the mod's own transcript line. */
async function toPerson($: EngineInterface, findings: readonly string[], line: string): Promise<void> {
  try {
    const taken = await $.sidebar.set({
      consumer: 'my-mod',              // your mod's name, drawn in the section heading
      key: 'src-users.ts',             // names the section inside your mod; [A-Za-z0-9._:-]
      title: 'SQL built from strings', // the heading beside the consumer
      lines: findings.map(text => ({ text, kind: 'warn' })), // kind: 'ok' | 'warn' | 'dim', or absent
      buttons: [{ label: 'fix', command: 'my-mod', args: 'fix src/users.ts' }], // optional
      until: 'stream',                 // 'stream' logs it, 'session' keeps it standing, 'turn' drops it at the turn's end
      order: 50,                       // smaller is higher inside your group; 100 when absent
    })
    if (taken) return
  } catch {
    // The sidebar mod is not installed, so $.sidebar is missing and the call throws.
  }
  $.ui.log(line)
}
```

`set` answers `true` when the section was kept and drawn, and `false` when the sidebar is closed, so one `if (taken) return` covers both the closed and the missing case. `clear({ consumer, key })` removes your standing section of that key and every stream entry of it, and `isOpen()` answers whether the pane is up.

`types/index.d.ts` is the contract: `SidebarSection`, `SidebarLine`, `SidebarButton`, `SidebarUntil` and `Sidebar`. `/plugin-types` copies it into `.claude/types/claude-code-plugins/` for every enabled plugin, so `$.sidebar` is typed in your mod with nothing copied by hand. Develop against it with `claude --plugin-dir <your mod> --plugin-dir <path to sidebar>`.

In a `claude plugin test` file the test engine runs no `engine.create`, so stub the noun with an inline plugin and answer its calls in the world:

```ts
const SIDEBAR: Plugin = {
  name: 'sidebar',
  register(on) {
    const stub = async (): Promise<never> => { throw new Error('answered by the test world') }
    on('engine.create', async (_, e, next) => ({ ...(await next(e)), sidebar: { set: stub, clear: stub, isOpen: stub } }))
  },
}
// then in the test: on('sidebar.set', (_, e) => ({ value: true }))
```

Limits per section: 50 lines and 5 buttons; the lines left out are counted in the pane. The pane draws as many rows as the surface gave its body, and at most 200. The stream holds its newest 100 entries in memory, however few of them the rows show. A line longer than the pane's width is cut. A section whose `consumer`, `key` or `title` is of another shape is refused with an error the calling mod reads.

## Command

    /sidebar            opens the pane, or closes it while it is open
    /sidebar on | off   the same, named
    /sidebar status     on or off, how many sections are up and how many entries the stream holds

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sidebar@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Run `/sidebar` once. From then on every session opens it until you run `/sidebar off`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ types ./types/index.d.ts declares on $: $.sidebar
    ❯ ./register.tsx hooks: engine.create, session.start, command.run{command=sidebar}, ui.render{component=Pane}, ui.close, turn.complete
    ❯ ./register.tsx calls: $.command.register, $.command.run (via pressButton), $.store.get, $.store.set, $.ui.close (via closePane), $.ui.invalidate, $.ui.open (via openPane), $.ui.panes (via closePane), $.ui.resolve

Reach L0, it draws and remembers.

    1. Reads:    the sections other mods hand over; no file, no process, no network
    2. Runs:     the slash command a button names, through $.command.run, on the person's press only
    3. Sends:    nothing
    4. Persists: in $.store, whether the sidebar is open; the sections live in memory for one session
    5. Hostile input: a section comes from another plugin and is read as data: the consumer, key and title are checked, every line and button of another shape is dropped, the text is folded to one line and cut to the width, and the counts are capped

## Limits

- The pane is placed beside the transcript only under the fullscreen layout; otherwise it opens above the prompt.
- A session that opens the sidebar from the stored choice opens it as the plugin, not as the person: the engine leaves such a pane undrawn below 144 terminal columns, 110 once the person opened that pane themselves. `/sidebar` in that session places it at any width.
- Closing the sidebar drops every section and the whole stream. Neither comes back when it is opened again; each mod writes its own at the next update.
- The stream holds the session only. It is not written to disk, so it does not survive a restart.
- A button can only run a slash command. A mod that wants a button must serve a command for it.
- The pane's scroll window belongs to the engine; this mod adds no scrolling of its own.

## Development

    make install     # eslint, typescript, typescript-eslint
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
