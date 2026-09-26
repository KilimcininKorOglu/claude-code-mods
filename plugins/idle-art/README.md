# idle-art

A Claude Code Mod that draws an ASCII animation above the prompt while the model works. Five scenes are built in: matrix rain, fire, a star field, an aquarium and the Game of Life. You can add your own: `/idle-art import` turns a GIF into a character clip and keeps it for every project. Display only: nothing reaches the model, so the mod costs no tokens and does not touch the prompt cache.

## What it shows

The picture appears 3 seconds into a turn, so a short turn shows nothing, and it goes away when the turn ends. By default each turn draws a scene at random from the built-in scenes and your saved clips, never the one shown before. A long turn moves on to another at random: a built-in scene after 20 seconds, a clip at the end of its first loop that ends after 20 seconds, so a long clip plays through once and a short one repeats until then. A scene you chose by name stays for the whole turn, and choosing one while a turn draws changes the picture at once.

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

## Your own GIFs

    /idle-art import ~/Downloads/cat.gif cat

The mod reads the GIF, decodes every frame with its own delay and transparency, and turns each frame into characters: every cell takes the mean colour of its pixels, and a glyph from `.:-=+*#%@` by its brightness, spread over the clip's own darkest to brightest cell. A cell mostly transparent stays blank. The picture keeps its shape and fills the 8 rows of the band; a cell counts as twice as tall as wide. The clip then plays in the middle of the band, each frame for its own delay, in a loop.

    ● Brewing… (6s)
        ....=*******++=+***+====-....
        ....=******=----=*#=====-....
        ....-+++++*==+----===---:....
        ....:--=###++*=-:-=-:---:....
        ....-+#%#%*--==-:-:-==--:....
        ....+**#*++-:-:---::::--:....
        ....-====+-=:--:::::.:-+-....
        ....:-=*++*+++=-:-=--=-=-....

A clip is kept under 90,000 characters, because that is what one drawing may hand the drawing thread. A longer clip keeps every other frame, each kept frame showing for the time of both, and does so again until it fits; the answer says how many frames stayed. The clips live in the mod's store, which holds 4 MiB in all, so about forty clips fit; a clip that does not fit is refused with the reason.

A name is lowercase letters, digits and dashes, up to 24 characters, and cannot be a built-in scene or a word the command reads. Importing under a saved name replaces that clip. A path starting with `~` is under your home directory, and a relative path is under the session's directory. A path may hold spaces: the last word is the name.

## Command

    /idle-art                          the state: on or off, the style, the delay
    /idle-art on | off                 draw or stop drawing
    /idle-art <scene or clip>          always draw that one: matrix, fire, stars, aquarium, life, or a saved clip
    /idle-art random                   a new scene or clip each turn and every 20 seconds or so (the default)
    /idle-art delay <n>                wait n seconds into a turn, 0 to 60 (default 3)
    /idle-art import <gif path> <name> turn a GIF into a clip and keep it under that name
    /idle-art list                     the built-in scenes and the saved clips
    /idle-art remove <name>            delete a saved clip; a style set to it goes back to random
    /idle-art help

The settings and the clips stay in the mod's store, shared by every project, and survive updates.

## How it draws

An `AbovePrompt` `ui.render` hook mounts a `Client` element while `isWorking` is true. The `Client` runs `hooks/scene.tsx` on the drawing thread: a 100 ms `surface.every` tick advances the scene and asks for the next frame, so no hook runs per frame. Each built-in scene is a pure module under `hooks/art/` that answers a grid of cells; a saved clip reaches the drawing thread in the `Client`'s props and plays from `hooks/clip.ts`. A row draws as one `Text` per run of one colour. The hooks module picks the scene and a random seed when the band first shows a working turn, a `$.clock.after` timer redraws the band once the delay has passed, and the main loop's `turn.complete` ends the turn, so the next one picks again. Under `random` the drawing thread counts a scene's time itself, and once it has run it posts the scene's name with `surface.post`; the `ui.message` hook picks the next scene and answers with its props, which the running instance takes in place. A message that names a scene no longer showing changes nothing, so a late or repeated post cannot skip one. No clip travels to the drawing thread before its turn to show, because one clip may take most of the 100,000 characters a `Client`'s props hold. The GIF decoder in `hooks/gif.ts` is written for this mod and needs no tool on the machine.

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

    ❯ ./register.tsx hooks: session.start, ui.render{component=AbovePrompt}, ui.message, turn.complete, command.run{command=idle-art}
    ❯ ./register.tsx calls: $.clock.after (via beginTurn), $.clock.now (via sceneFor), $.command.register, $.env.get (via resolvePath), $.fs.exists (via readGifBytes), $.fs.read (via readGifBytes), $.fs.stat (via readGifBytes), $.process.spawn (via streamedStdout), $.session.cwd (via resolvePath), $.store.delete (via removeClip), $.store.get (via loadClips, loadConfig), $.store.set (via importGif, removeClip, saveClips, setting), $.ui.invalidate (via beginTurn, setting), $.ui.resolve
    ❯ ./register.tsx env reads: HOME
    ❯ ./register.tsx surface modules: hooks/scene.tsx

Reach L2, runs `base64` to read a GIF over 4 MiB.

    1. Reads:    the band's props (working, survey, rows, columns) and the clock; its settings and clips from the store; the GIF a /idle-art import names, once, when it is 32 MiB or smaller; HOME and the session's directory to resolve that path
    2. Runs:     base64 -i <path> for a GIF over 4 MiB, once per import; no fork; one timer per turn for the delay, and the drawing thread's 100 ms tick while the band shows
    3. Sends:    nothing; no network call and nothing to the model
    4. Persists: the on/off state, the style, the delay and each imported clip in the mod's store
    5. Hostile input: a GIF is untrusted bytes: the decoder bounds every read by the file's length, refuses a broken code stream or a missing color table, stops at 500 frames, and an import that fails keeps nothing; a stored clip of the wrong shape is skipped at load; the command takes a fixed word list, a whole number from 0 to 60, and a clip name of lowercase letters, digits and dashes

## Limits

- 8 rows is a small canvas: a GIF becomes about 30 columns by 8 rows at the usual 2:1 shape, enough for a silhouette or a motion, not for detail.
- A GIF of up to 4 MiB is read with `$.fs.read`. A larger one, up to 32 MiB, is read through `base64 -i <path>` piece by piece, because `$.fs.read` refuses a file over 4 MiB and `$.process.run` cuts its output at 4 MiB (measured on 2.1.283). The bytes that come back must match the file's size, or the import is refused.
- Each frame is reduced to its cells as it is decoded, so a large GIF holds one frame of pixels at a time. A GIF stops at 500 frames.
- A long GIF loses frames to the 90,000-character limit; its motion stays as long, but steps more coarsely.
- The terminal draws the colours with its own palette; a terminal without true colour shows the nearest of its 256 colours.
- `matrix` draws half-width katakana, and `stars` draws `∗` and `✦`. A font without those glyphs draws a replacement character.

## Development

    make install     # eslint, typescript-eslint, typescript
    make lint        # complexity limit 10, fails the build above it
    make typecheck   # needs .claude/types/ from /plugin-types
    make validate
    make test        # claude plugin test
