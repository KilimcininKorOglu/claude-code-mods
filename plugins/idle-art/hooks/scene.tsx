import type { ClientModule, ClientSurface, RenderElement } from 'claude-code'
import { isStyle, sceneOf } from './config.ts'
import { rngOf, runsOf, sceneDone, type Animation, type Frame } from './art/grid.ts'
import { SCENES } from './art/scenes.ts'
import { playClip, type Clip } from './clip.ts'

/**
 * What the hooks module hands this instance: the scene's style and seed, the region, a saved clip's frames,
 * and whether the scene gives way to another once it has run its time (the `random` choice).
 */
export type SceneProps = { style: string; seed: number; width: number; height: number; clip?: Clip; rotate?: boolean }

/** What an instance posts when its scene has run its time: the scene it asks to leave. */
export type NextMessage = { next: string }

/**
 * The running animation and what it was started for, so new props start a new one; how long it has run,
 * and whether it has asked for the next scene.
 */
type Live = { anim: Animation; key: string; scene: string; rotate: boolean; ms: number; asked: boolean }

/** Milliseconds per animation tick. */
const TICK_MS = 100

function keyOf(p: SceneProps): string {
  return `${sceneOf(p)}:${p.width}x${p.height}`
}

function animOf(p: SceneProps): Animation | undefined {
  if (p.width < 1 || p.height < 1) return undefined
  if (p.clip !== undefined) return playClip(p.clip, p.width, p.height, TICK_MS)
  return isStyle(p.style) ? SCENES[p.style](p.width, p.height, rngOf(p.seed)) : undefined
}

function start(p: SceneProps): Live | undefined {
  const anim = animOf(p)
  return anim === undefined ? undefined : { anim, key: keyOf(p), scene: sceneOf(p), rotate: p.rotate === true, ms: 0, asked: false }
}

/** One tick: advance the scene, and once it has run its time, ask the hooks module for the next one, once. */
function tick(surface: ClientSurface<Live>): void {
  const now = surface.state
  if (now === undefined) return
  now.anim.step()
  now.ms += TICK_MS
  if (now.rotate && !now.asked && sceneDone(now.anim, now.ms)) {
    now.asked = true
    surface.post({ next: now.scene } satisfies NextMessage)
  }
  surface.setState({ ...now })
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
    if (live === undefined) surface.every(TICK_MS, () => tick(surface))
    live = fresh
    surface.setState(live)
  }
  return draw(surface, live.anim.frame())
}

export default Scene
