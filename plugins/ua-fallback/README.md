# ua-fallback

A Claude Code Mod for the retrieval fallback: when a `curl` or `wget` is refused by an automated-client filter, the mod tells the model to retry once with a browser User-Agent, and states the two cases where it must not.

## What it does

1. The mod hooks the Bash tool. After a `curl` or `wget` call it reads the command's own output, both streams, for a status an automated-client filter answers with: `403` or `429`, in any of the forms those commands print (`HTTP/2 403`, `403 Forbidden`, `curl: (22) ... error: 403`, `429 Too Many Requests`, `Rate limit`).
2. A command that already sets a User-Agent (`-A`, `--user-agent`, `-U`, a `User-Agent` header) is left alone: the advice is spent.
3. The model reads this note after the tool's result:

       ua-fallback: example.com answered 403, which is an automated-client filter, not a broken URL. Retry the same request once with a browser User-Agent: -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'. If that is refused too, one of OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User may pass. Do not do this while testing an application, an API, an auth flow or a client of your own: a changed User-Agent hides the access-control or compatibility problem you are measuring. A reply you get with another User-Agent is not proof the resource works for ordinary clients, and it is never a way around authentication or a permission.

   The last two sentences ride in every note, because the retry is only for public content. A request sent to measure an application's own behaviour must keep its real client, and a success under another User-Agent says nothing about ordinary clients.
4. The same moment writes one line to the transcript, the finding alone, without the instruction:

       ua-fallback: example.com answered 403; a browser User-Agent may pass

5. While the [sidebar](../sidebar) is open, that finding goes there instead, the host and status on the first line and `not while testing your own app, auth flow or client` faint under it, as an entry in its stream, and the transcript stays clean. With the sidebar closed, or without that mod installed, the transcript line is written as above.
6. One host speaks once per session. The second refused request from the same host is quiet, so a loop of retries does not fill the context.

## Command

    /ua-fallback            on or off, and the hosts this session was refused by
    /ua-fallback on | off   on by default

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ua-fallback@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.278:

    ❯ ./register.ts hooks: session.start, command.run{command=ua-fallback}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get, $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L1, reads the session.

    1. Reads:    each Bash command's text and its two output streams, for a URL and a status
    2. Runs:     nothing; it sends no request of its own, so the server sees one request, not two
    3. Sends:    a note to the model after the tool's result, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting
    5. Hostile input: the output is matched against fixed status patterns and nothing from it is copied into the note; only the URL's host is, and the User-Agent strings are constants in the mod

## Limits

- The status is read from what the command printed. A silent `curl -s` that prints only a body with no status text gets no note.
- A page that says "403" in its own prose reads as a filtered request. The note is advice, not a measurement of the response code.
- The mod does not rewrite the command and sends no request of its own, so a filter it cannot see in the output stays unreported.
- A failed call (a non-zero exit, as `curl --fail` gives on a 403) is reported to the person but not to the model, so the model's own error text stays as it is.
- The browser User-Agent is a constant in `hooks/fetch.ts` and ages. A site that checks a current version may refuse it.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
