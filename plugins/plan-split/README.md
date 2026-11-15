# plan-split

Runs the main loop on one model in plan mode and on another in every other mode, switched by itself, set with /plan-split and off until /plan-split on.

Plan with a model that thinks harder and write the code with another: by default plan mode runs on Fable and every other mode on Opus. You do not pick the model by hand when you enter or leave plan mode; the mod changes the model of each main-loop request to the side of the mode it runs in.

## What it does

- **Plan mode** (`plan`): each main-loop request goes to the plan model.
- **Every other mode** (`default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`): each main-loop request goes to the code model.
- **No known mode**: the request keeps the session's model. A session learns its mode with its first prompt.
- **A subagent** keeps its own model. The mod changes main-loop requests only.

The mode reaches the mod from three places:

1. The prompt that starts a turn carries the mode the turn starts in, so Shift+Tab between two prompts applies at the next prompt.
2. Each tool call carries the mode after it, so Shift+Tab during a turn applies after the next tool call.
3. An accepted `EnterPlanMode` or `ExitPlanMode` moves the side at once. After you approve a plan, the next request of the same turn already runs on the code model. A rejected `ExitPlanMode` keeps plan mode.

Each change of model shows in the [sidebar](../sidebar) section `plan-split` (`plan · claude-fable-5-1[1m]`, and the two settings under it). With the sidebar closed or not installed, a change writes one transcript line:

    plan-split: plan mode: the main loop runs on claude-fable-5-1[1m]

## Models

A setting is a Claude Code alias (`fable`, `opus`, `sonnet`, `haiku`) or a model id (`claude-fable-5-2`). An alias reads the same way Claude Code reads it: with `ANTHROPIC_DEFAULT_FABLE_MODEL` (and the `OPUS`, `SONNET`, `HAIKU` variables) set, the alias stands for that id, `[1m]` suffix included; without the variable, the alias goes to the engine as written and answers on the newest model of that family (measured on 2.1.322: `sonnet` answered as `claude-sonnet-5-5`). So an alias follows new model releases, and a model id stays fixed.

## Cost of a switch

A model reads only its own prompt cache. Measured on 2.1.322: the first request after a switch wrote the whole conversation to the new model's cache (about 94,000 tokens, none read), and the request after it read the cache normally. Switching back to a model that ran earlier in the session read that model's old cache, when it was still warm. So each plan-to-code switch costs one full cache write on the code model, and a long plan conversation makes that write larger.

## Command

    /plan-split               the status: on or off, both models, the mode the main loop is in now
    /plan-split on            route by mode from the next request on
    /plan-split off           every request keeps the session's model again
    /plan-split plan <model>  the plan mode model, default fable
    /plan-split code <model>  the model of every other mode, default opus

The settings live in the store every window shares and are read at each prompt, so a change in one window applies in the others at their next prompt.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install plan-split@kilimcininkoroglu-mods

Function hooks are early access. Claude Code 2.1.288 and later load them by default, so there is nothing to switch on.

## After installing

1. Restart Claude Code.
2. Run `/plan-split on`. The mod is off after an install and changes nothing until then.
3. To use other models, run `/plan-split plan <model>` and `/plan-split code <model>`.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.322:

    ❯ ./register.ts hooks: session.start, command.run{command=plan-split}, prompt.submit, classic.UserPromptSubmit, classic.PostToolUse, tool.call{tool=/"^(EnterPlanMode|ExitPlanMode)$"/}, turn.step
    ❯ ./register.ts calls: $.command.register, $.env.get (via aliasEnv), $.sidebar.clear (via dropSection), $.sidebar.set (via toPerson), $.store.get (via readSettings), $.store.set (via setModel, switchTo), $.ui.log (via toPerson)

Reach L2: it changes the model of Claude's own requests.

    1. Reads:    the permission mode of each prompt and tool call, the result of EnterPlanMode and ExitPlanMode, the model of each main-loop request, and the four ANTHROPIC_DEFAULT_*_MODEL variables
    2. Runs:     nothing
    3. Sends:    nothing of its own; it names the model each main-loop request goes to, through Claude Code's own API connection
    4. Persists: in $.store, the on/off setting and the two model settings
    5. Hostile input: a model setting must be an alias or a model id (letters, digits, `.`, `-`, `[`, `]`); any other text is refused

## Limits

- Each switch writes the whole conversation to the new model's cache once (see "Cost of a switch").
- The model named for a side must be one your account can use. A model the API refuses fails that request as any wrong model would.
- A plan model with a smaller context window than the conversation fails the request. Keep the `[1m]` suffix on both sides when the session runs with a 1M window.
- Shift+Tab during a turn applies only after the next tool call, because no hook reports the mode before that.
- [effort-auto](../effort-auto) changes the effort of the same requests; both work together, and the effort applies to whichever model plan-split names.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, the build fails above it
    make validate
    make test        # claude plugin test
