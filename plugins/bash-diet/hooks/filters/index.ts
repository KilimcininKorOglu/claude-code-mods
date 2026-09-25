import type { Classified } from '../rules.ts'
import type { Filter, FilterTable } from './common.ts'
import { GH } from './gh.ts'
import { GIT } from './git.ts'

/** Every ecosystem's table; a later table's key wins over an earlier one's. */
const TABLES: FilterTable[] = [GIT, GH]

const FILTERS: FilterTable = Object.assign({}, ...TABLES)

/** The filter for a classified command: `tool sub` first, then `tool` alone, or undefined. */
export function filterFor(c: Classified): Filter | undefined {
  return FILTERS[`${c.tool} ${c.sub}`] ?? FILTERS[c.tool]
}
