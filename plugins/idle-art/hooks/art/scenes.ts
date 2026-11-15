import { aquarium } from './aquarium'
import { cat } from './cat'
import { fire } from './fire'
import type { Maker } from './grid'
import { matrix } from './matrix'
import type { Style } from '../config'

export const SCENES: Record<Style, Maker> = { matrix, fire, aquarium, cat }
