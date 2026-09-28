# ua-fallback

Some sites turn away `curl` and `wget` just because they look like bots, and the model then tends to give up on a perfectly good URL. This mod catches that moment: when a request is refused by a bot filter, it tells the model to try once more with a browser User-Agent, and it also tells it the two cases where it must not.

## What it does

1. It watches the Bash tool. After every `curl` or `wget` it reads both output streams and looks for the status a bot filter answers with, `403` or `429`, in any of the shapes these tools print it: `HTTP/2 403`, `403 Forbidden`, `curl: (22) ... error: 403`, `status: 403`, `429 Too Many Requests`, `Rate limit`.
2. If the command already sets its own User-Agent (`-A`, `--user-agent`, `-U` or a `User-Agent` header), it stays quiet. That advice has already been tried.
3. Right after the tool's result, the model reads this note:

       ua-fallback: example.com answered 403, which is an automated-client filter, not a broken URL. Retry the same request once with a browser User-Agent: -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'. If that is refused too, one of OpenAI File Downloader, XaiImageApiFetch/1.0, Claude-User may pass. Do not do this while testing an application, an API, an auth flow or a client of your own: a changed User-Agent hides the access-control or compatibility problem you are measuring. A reply you get with another User-Agent is not proof the resource works for ordinary clients, and it is never a way around authentication or a permission.

   The last two sentences are in every note on purpose. The retry is for public content only. When you are testing your own app, the request has to go out with its real client, and a success under a borrowed User-Agent tells you nothing about how ordinary clients fare.
4. You get one line in the transcript at the same time: just the finding, no instructions.

       ua-fallback: example.com answered 403; a browser User-Agent may pass

5. With the [sidebar](../sidebar) open, the finding goes into its stream instead and the transcript stays clean. The first line shows the host and the status (`429` yellow, `403` red, the retry hint faint), and a faint line under it reads `not while testing your own app, auth flow or client`. Without the sidebar, the line lands in the transcript as above.
6. Each host speaks up once per session. A second refusal from the same host passes quietly, so a string of retries does not fill up the context.

## Command

    /ua-fallback            on or off, and the hosts that refused this session
    /ua-fallback on | off   turns it on or off; it is on after install

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install ua-fallback@kilimcininkoroglu-mods

Function hooks are early access, and no mod loads without the flag. To keep it on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

1. Restart Claude Code.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.ts hooks: session.start, command.run{command=ua-fallback}, tool.call{tool=Bash}
    ❯ ./register.ts calls: $.command.register, $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via runCommand), $.ui.log (via toPerson)

Reach L1: it only reads the session.

    1. Reads:    each Bash command's text and its two output streams, for a URL and a status
    2. Runs:     nothing; it sends no request of its own, so the server sees one request, not two
    3. Sends:    a note to the model after the tool's result, and one line to the transcript; nothing leaves the machine
    4. Persists: in $.store, the on/off setting
    5. Hostile input: the output is matched against fixed status patterns and nothing from it is copied into the note; only the URL's host is, and the User-Agent strings are constants in the mod

## Limits

- The status comes from what the command printed. A silent `curl -s` that prints only the body gives it nothing to read, so no note.
- A page that happens to say "403" in its own text looks like a filtered request. The note is advice; it does not measure the response code.
- The mod never rewrites the command and never sends a request itself, so a filter that leaves no trace in the output goes unnoticed.
- A failed call (`curl --fail` and `wget` exit non-zero on a 403) is read from its error text, and both you and the model get the finding. The note goes after the error text the model sees, which stays as it is.
- The browser User-Agent is a constant in `hooks/fetch.ts`, and it ages. A site that insists on a current browser version may still refuse it.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
