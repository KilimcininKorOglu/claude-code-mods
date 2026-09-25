# sidebar

A Claude Code Mod that opens one shared pane beside the transcript and draws what every other mod writes into it. There is one sidebar, not one pane per mod: a mod calls `$.sidebar.set(...)` with a section of lines and buttons, and this mod draws it.

## What it does

1. `/sidebar` opens the pane and `/sidebar off` closes it. The choice is kept in `$.store`, so a session started later opens the sidebar again by itself.
2. While it is open, any mod writes a section: `$.sidebar.set({ consumer, key, title, lines, buttons, until, order })` answers `true`. While it is closed nothing is kept and the call answers `false`, so the mod keeps showing its own transcript line or status line instead.
3. A section is drawn as a bold heading (`<consumer>: <title>`, plus the time for a stream entry), its lines (`ok` green, `warn` yellow, `error` red, `dim` faint) and its buttons. The pane has two parts: the standing sections at the top (`until: 'session'`, then `until: 'turn'`, each group by `order`, then consumer, then key), and the stream under them.
4. The stream is what `until: 'stream'` writes: a log of findings, newest first, right under the standing sections. While both are drawn, a faint divider row separates them: dashes across the pane's width with an `o` in the middle (`---------o---------`). An entry never replaces another, so the same mod and key twice reads as two entries. A stream entry's heading also carries the day and time it was written, in the machine's own time zone (`edit-loop: edit loop (21.09 14:32)`), so the person reads the log after the fact; a standing section carries none, because it is rewritten at every measure. Nothing drops an entry at the turn's end: an entry leaves only when newer ones push it past the pane's last row. A taller terminal holds more of the stream, a shorter one less. The stream's rows are shared: while several mods write into it, each one draws at most its own share of the rows, so a talkative mod cannot push another mod's finding off the pane. The rows a share leaves over go to the entries it held back, and a mod writing alone takes the whole area.
5. A button runs a slash command: pressing `[ stop ]` of `{ label: 'stop', command: 'bg-tasks', args: 'stop b1' }` runs `/bg-tasks stop b1` as the person would, and the command's first answer line shows at the foot of the pane. The mod that offers the button serves that command itself. The label turns red under the pointer, so what a press would run is plain before the press.
6. The three lifetimes: `session` stands at the top until the mod replaces or clears it, `stream` joins the log under it, `turn` goes when the turn ends.
7. Every stream entry is also written to this project's own log file, `~/.claude/sidebar/<project>-<YYYY-MM-DD>.log`, one JSON object per line. When the pane opens, the newest 10 entries of that project's logs come back into the stream, each with the day and time it was first written, so a session started tomorrow still shows what yesterday found. A restored entry is not written to the log again. The day is the day of the write, so a session that runs past midnight writes the new day's file. Every write reads the file again first, so two sessions of one project on one day keep each other's lines; a file that is there and cannot be read is not written over. A `clear` that takes stream entries down writes one line of its own to the log (`{"at", "cleared": {consumer, key}}`): the entries stay in the file as history, and the restore leaves out every entry of that key written before the line, also when the line sits in a newer day's file. A closed finding therefore does not come back beside its own closing line. `/sidebar log` prints the file's path and its newest 10 entries, the cleared ones among them.

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
      lines: findings.map(text => ({ text, kind: 'error' })), // kind: 'ok' | 'warn' | 'error' | 'dim', or absent
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

`set` answers `true` when the section was kept and drawn, and `false` when the sidebar is closed, so one `if (taken) return` covers both the closed and the missing case. `clear({ consumer, key })` removes your standing section of that key and every stream entry of it, and keeps a later session from taking those entries back from the log; `isOpen()` answers whether the pane is up.

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

Limits per section: 50 lines and 5 buttons; the lines left out are counted in the pane. The pane draws as many rows as the surface gave its body, and at most 200. The stream holds its newest 20 entries per consumer and 100 in all, however few of them the rows show, and the rows it draws are shared between the consumers writing into it. A line longer than the pane's width is cut. A section whose `consumer`, `key` or `title` is of another shape is refused with an error the calling mod reads.

## Command

    /sidebar            opens the pane, or closes it while it is open
    /sidebar on | off   the same, named
    /sidebar status     on or off, how many sections are up and how many entries the stream holds
    /sidebar log        the path of this project's log of today, and its newest 10 entries

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install sidebar@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Run `/sidebar` once. From then on every session opens it until you run `/sidebar off`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ types ./types/index.d.ts declares on $: $.sidebar
    ❯ ./register.tsx hooks: engine.create, session.start, command.run{command=sidebar}, ui.render{component=Pane}, ui.close, turn.complete
    ❯ ./register.tsx calls: $.clock.now, $.command.register, $.command.run (via pressButton), $.env.get (via openLog), $.fs.exists, $.fs.list (via logFiles), $.fs.read, $.fs.write, $.session.cwd (via openLog), $.store.get, $.store.set, $.ui.close (via closePane), $.ui.invalidate, $.ui.open (via openPane), $.ui.panes (via closePane), $.ui.resolve
    ❯ ./register.tsx env writes: nothing
    ❯ ./register.tsx env reads: HOME

Reach L2, it writes a file.

    1. Reads:    the sections other mods hand over, the clock for a stream entry's own time, HOME, the session's directory, and this project's own log files under ~/.claude/sidebar
    2. Runs:     the slash command a button names, through $.command.run, on the person's press only
    3. Sends:    nothing
    4. Persists: in $.store, whether the sidebar is open; in ~/.claude/sidebar, one log file per project and day, holding the stream entries other mods wrote and one line per clear that took entries down
    5. Hostile input: a section comes from another plugin and is read as data: the consumer, key and title are checked, every line and button of another shape is dropped, the text is folded to one line and wrapped to the width, and the counts are capped. A log line is read the same way, so a hand-edited or truncated file loses that line and nothing else.

## Limits

- The log directory was `~/.claude/stream` up to 0.7.0 and is `~/.claude/sidebar` from 0.8.0, so every mod's own directory carries the mod's name. Nothing is migrated: the old files stay on disk unread. Move them yourself to keep the restore of older days: `mv ~/.claude/stream/* ~/.claude/sidebar/`.

- The pane is placed beside the transcript only under the fullscreen layout; otherwise it opens above the prompt.
- A session that opens the sidebar from the stored choice opens it as the plugin, not as the person: the engine leaves such a pane undrawn below 144 terminal columns, 110 once the person opened that pane themselves. `/sidebar` in that session places it at any width.
- Closing the sidebar drops every section and the whole stream. Neither comes back when it is opened again; each mod writes its own at the next update.
- The stream in the pane holds the session; the log on disk is what survives a restart, and only its newest 10 entries come back.
- The log is per project and per day. The project is the last part of the directory the session started in, so two checkouts of one repository share a log file.
- One day's file keeps its newest 500 lines. Nothing removes an old day's file; that is yours to clean.
- The whole file is rewritten at each entry, because the engine's `$.fs` has no append. A write that fails is passed over and the pane keeps working.
- A stream entry's time is the moment the mod wrote it, read from `$.clock.now()` and drawn in the machine's own time zone. It is not the moment the finding happened, and it does not change afterwards.
- A line longer than the pane's width is wrapped, at the last space that fits, over at most 4 rows, each row after the first indented by two spaces. A line longer than those 4 rows has its last row cut with `…`. A heading is cut, not wrapped.
- The stream keeps 20 entries per consumer and 100 in all. Over its own count a mod drops its own oldest entry, never another mod's.
- A button can only run a slash command. A mod that wants a button must serve a command for it.
- The pane's scroll window belongs to the engine; this mod adds no scrolling of its own.

## Development

    make install     # eslint, typescript, typescript-eslint
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
