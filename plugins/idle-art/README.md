# idle-art

A Claude Code Mod that draws an ASCII animation above the prompt while the model works. Five scenes: matrix rain, fire, a star field, an aquarium and the Game of Life. Display only: nothing reaches the model, so the mod costs no tokens and does not touch the prompt cache.

## What it shows

The picture appears 3 seconds into a turn, so a short turn shows nothing, and it goes away when the turn ends. By default each turn draws a scene at random, never the one of the turn before.

    ● Brewing… (5s)
             .:   .                 ,
                       ,   ::,,,
        ::;;:;    ;;::;          .
         ,  ;:+ :*;++++      , ,,
        :::*oO;*:;*:+:  :+++,::**o ++:, :
      ;,,   ;,;+;+::+;,;+:**+**,;  ;  ,
     :  +;*:+**o*;;;;*+**:,*:;;***o:,::;;
    :,::;oOoO*ooOOO#oO*o*O*o**OOOoOo;+;,

| Scene | What moves |
|---|---|
| `matrix` | Streams of half-width katakana and digits fall in green, a bright head over a fading trail; glyphs under a trail flicker. |
| `fire` | Heat rises from a hidden row under the band and cools on the way up, drawn from `.` to `@` and from dark red to pale yellow. |
| `stars` | Stars fly toward the viewer from the centre, growing from a grey `·` to a white `✦` as they near. |
| `aquarium` | Fish of four shapes cross both ways, bubbles rise from them and grow, seaweed sways on the sand. |
| `life` | Conway's Game of Life on a wrapping board of half blocks, two cells per row; newborn cells are pink, older ones violet. The board is seeded again when it dies out, repeats or reaches 300 generations. |

The band takes at most 8 rows and 100 columns, fewer when the terminal has less room, and draws nothing in a band under 3 rows. It draws on the terminal only, and gives way to a survey.

## Command

    /idle-art                 the state: on or off, the style, the delay
    /idle-art on | off        draw or stop drawing
    /idle-art <scene>         always draw that scene: matrix, fire, stars, aquarium, life
    /idle-art random          a new scene each turn (the default)
    /idle-art delay <n>       wait n seconds into a turn, 0 to 60 (default 3)
    /idle-art help

The settings stay in the mod's store and survive updates.

## How it draws

An `AbovePrompt` `ui.render` hook mounts a `Client` element while `isWorking` is true. The `Client` runs `hooks/scene.tsx` on the drawing thread: a 100 ms `surface.every` tick advances the scene and asks for the next frame, so no hook runs per frame. Each scene is a pure module under `hooks/art/` that answers a grid of cells; a row draws as one `Text` per run of one colour. The hooks module picks the style and a random seed when the band first shows a working turn, and a `$.clock.after` timer redraws the band once the delay has passed.

## Install

    claude plugin marketplace add KilimcininKorOglu/claude-code-mods
    claude plugin install idle-art@kilimcininkoroglu-mods

Function hooks are early access. Nothing loads without the flag:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude

Load it from a local checkout for one session:

    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir plugins/idle-art

To keep the flag on, add this to `~/.claude/settings.json`:

    { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }

## After installing

Restart Claude Code, or run `/reload-plugins` in an open session. The mod is on after an install; `/idle-art off` turns it off.

## What it can reach

Validated with `claude plugin validate` on Claude Code 2.1.283:

    ❯ ./register.tsx hooks: session.start, ui.render{component=AbovePrompt}, turn.complete, command.run{command=idle-art}
    ❯ ./register.tsx calls: $.clock.after (via beginTurn), $.clock.now (via sceneFor), $.command.register, $.store.get (via loadConfig), $.store.set (via apply), $.ui.invalidate (via apply, beginTurn), $.ui.resolve
    ❯ ./register.tsx surface modules: hooks/scene.tsx

Reach L0, draws and remembers.

    1. Reads:    the band's props (working, survey, rows, columns) and the clock; its own three settings from the store
    2. Runs:     nothing; no process and no fork; one timer per turn for the delay, and the drawing thread's 100 ms tick while the band shows
    3. Sends:    nothing; no network call and nothing to the model
    4. Persists: the on/off state, the style and the delay in the mod's store
    5. Hostile input: none reaches it; the command takes a fixed word list and a whole number from 0 to 60, anything else is refused with the usage line

## Limits

- The terminal draws the scenes' colours with its own palette; a terminal without true colour shows the nearest of its 256 colours.
- `matrix` draws half-width katakana, and `stars` draws `∗` and `✦`. A font without those glyphs draws a replacement character.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
