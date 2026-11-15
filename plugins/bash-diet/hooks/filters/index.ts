import type { Classified } from '../rules'
import { APPLE } from './apple'
import { BUNDLE } from './bundle'
import { CLOUD } from './cloud'
import type { Filter, FilterTable } from './common'
import { DOTNET } from './dotnet'
import { FORMAT } from './format'
import { GH } from './gh'
import { GIT } from './git'
import { GO } from './go'
import { JS } from './js'
import { JVM } from './jvm'
import { MAKE } from './make'
import { PHP } from './php'
import { PYTHON } from './python'
import { RUBY } from './ruby'
import { RUST } from './rust'
import { SYSTEM } from './system'

/** Every ecosystem's table; a later table's key wins over an earlier one's. */
const TABLES: FilterTable[] = [GIT, GH, RUST, GO, PYTHON, JS, SYSTEM, CLOUD, JVM, RUBY, PHP, DOTNET, APPLE, FORMAT, BUNDLE, MAKE]

const FILTERS: FilterTable = Object.assign({}, ...TABLES)

/** The filter for a classified command: `tool sub` first, then `tool` alone, or undefined. */
export function filterFor(c: Classified): Filter | undefined {
  return FILTERS[`${c.tool} ${c.sub}`] ?? FILTERS[c.tool]
}
