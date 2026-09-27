import { aquarium } from './aquarium.ts'
import { cat } from './cat.ts'
import { fire } from './fire.ts'
import type { Maker } from './grid.ts'
import { matrix } from './matrix.ts'
import type { Style } from '../config.ts'

export const SCENES: Record<Style, Maker> = { matrix, fire, aquarium, cat }
