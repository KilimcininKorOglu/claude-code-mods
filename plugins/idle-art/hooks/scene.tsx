import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'
import { isStyle } from './config.ts'
import { rngOf, runsOf, type Animation, type Frame } from './art/grid.ts'
import { SCENES } from './art/scenes.ts'

/** What the hooks module hands this instance: the turn's style and seed, and the region. */
export type SceneProps = { style: string; seed: number; width: number; height: number }

/** The running animation and what it was started for, so new props start a new one. */
type Live = { anim: Animation; key: string }

/** Milliseconds per animation tick. */
const TICK_MS = 100

function keyOf(p: SceneProps): string {
  return `${p.style}:${p.seed}:${p.width}x${p.height}`
}

function start(p: SceneProps): Live | undefined {
  if (!isStyle(p.style) || p.width < 1 || p.height < 1) return undefined
  return { anim: SCENES[p.style](p.width, p.height, rngOf(p.seed)), key: keyOf(p) }
}

function draw(surface: ClientSurface<Live>, frame: Frame): RenderElement {
  const { Box, Text } = surface.elements
  return (
    <Box flexDirection="column">
      {frame.map((row, y) => (
        <Text key={String(y)} wrap="truncate">
          {runsOf(row).map((run, i) => (run.color === '' ? run.text : <Text key={String(i)} color={run.color}>{run.text}</Text>))}
        </Text>
      ))}
    </Box>
  )
}

/** Draws one frame per tick; the tick only advances the animation and asks for the next call. */
const Scene: ClientModule<SceneProps, Live> = (props, surface) => {
  let live = surface.state
  if (live === undefined || live.key !== keyOf(props)) {
    const fresh = start(props)
    if (fresh === undefined) return surface.elements.Text({ children: '' })
    // The first call starts the clock; later calls reach here only on new props.
    if (live === undefined) {
      surface.every(TICK_MS, () => {
        const now = surface.state
        if (now === undefined) return
        now.anim.step()
        surface.setState({ ...now })
      })
    }
    live = fresh
    surface.setState(live)
  }
  return draw(surface, live.anim.frame())
}

export default Scene
