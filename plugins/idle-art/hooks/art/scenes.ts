import { aquarium } from './aquarium.ts'
import { fire } from './fire.ts'
import type { Maker } from './grid.ts'
import { life } from './life.ts'
import { matrix } from './matrix.ts'
import { stars } from './stars.ts'
import type { Style } from '../config.ts'

export const SCENES: Record<Style, Maker> = { matrix, fire, stars, aquarium, life }
