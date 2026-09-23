# orphan-server

A Claude Code Mod that lists the servers a Bash call of the model started in this repository and left listening on a port, with their age and session and a stop button for each. A server started with `(cmd &)` outlives the session that started it, and nothing else tells you it still runs.

## What it does

1. At session start, at the end of each main-loop turn and at `/orphan-server`, the mod reads the processes that listen on a TCP port (`lsof -nP -iTCP -sTCP:LISTEN`).
2. It keeps only a process whose parent is 1 (it outlived the shell that started it) and whose working directory is the session's git repository or a directory under it.
3. It reads this repository's transcripts for the Bash call that started each one: a call that ran while the process started (after the model wrote it, before its result) and whose command holds the process's arguments. Only the transcript lines of the minutes that call can sit in are read, and each process is looked up once.
4. The servers found stand in one yellow [sidebar](../sidebar) section, oldest first, with a stop button each:

       :8787 Python -m http.server 8787 · 3h · session 450600b2
       [ stop :8787 ]

   While the sidebar is closed, one transcript line names them with their pids, once per set of servers, and the section is drawn at the next scan after the sidebar opens.
5. The button runs `/orphan-server stop <pid>`. The mod reads the process again first; a pid that no longer belongs to the listed server (another parent, other arguments, another start time) gets no signal. Otherwise it sends SIGTERM, and SIGKILL after 5 seconds if the server still runs. A green line says `stopped :8787 ...`, or a red line says it still runs after SIGKILL.

## Command

    /orphan-server             reads the servers now and lists them with their pids
    /orphan-server stop <pid>  SIGTERM, then SIGKILL after 5 s, to a listed server
    /orphan-server on | off    on by default; off reads only at /orphan-server

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install orphan-server@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.
2. Install the [sidebar](../sidebar) mod for the section and its stop buttons. Without it the mod writes one transcript line and `/orphan-server stop <pid>` stops a server.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.280:

    ❯ ./register.ts hooks: session.start, command.run{command=orphan-server}, turn.complete
    ❯ ./register.ts calls: $.clock.after (via later, stop), $.clock.now (via listenersIn, readProc, runCommand, show, toSidebar), $.command.register, $.env.get, $.process.run (via output, rootOf), $.session.id, $.sidebar.clear (via toSidebar), $.sidebar.set (via toSidebar, toStream), $.store.get, $.store.set (via setEnabled), $.ui.log (via later, show, stop, toStream)
    ❯ ./register.ts env writes: nothing
    ❯ ./register.ts env reads: CLAUDE_CONFIG_DIR, HOME

Reach L2, it runs processes and sends signals.

    1. Reads:    the listening TCP processes (pid, ports, parent, age, arguments, working directory), and the transcript lines of this repository's sessions for the minutes around each one's start
    2. Runs:     git rev-parse --show-toplevel once per session; lsof, ps and grep at session start, at each turn's end and at /orphan-server; kill -TERM and kill -KILL for a server you stop
    3. Sends:    nothing to the model and nothing to the network
    4. Persists: in $.store, the on/off setting
    5. Hostile input: a process's arguments and a transcript's commands are drawn as text and compared as text, never run; the pid of a stop is read again before a signal is sent

## Limits

- Only the transcripts of the repository root and of the session's start directory are read. A server that an old session opened in another subdirectory started is not listed.
- A server started through a wrapper that still runs (`npm run dev`, `make serve`) is not listed, because its parent is the wrapper and not 1.
- The match is by time and command text. Two processes started in the same call with the same arguments read as one server each, and both are listed.
- A process with arguments shorter than 3 characters is never matched.
- A server you started by hand outside Claude Code is never listed, because no transcript holds its Bash call.
- `lsof` and `ps` answer for your own processes only.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
