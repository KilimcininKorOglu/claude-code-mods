import type { Classified } from '../rules.ts'
import { APPLE } from './apple.ts'
import { CLOUD } from './cloud.ts'
import type { Filter, FilterTable } from './common.ts'
import { DOTNET } from './dotnet.ts'
import { FORMAT } from './format.ts'
import { GH } from './gh.ts'
import { GIT } from './git.ts'
import { GO } from './go.ts'
import { JS } from './js.ts'
import { JVM } from './jvm.ts'
import { PHP } from './php.ts'
import { PYTHON } from './python.ts'
import { RUBY } from './ruby.ts'
import { RUST } from './rust.ts'
import { SYSTEM } from './system.ts'

/** Every ecosystem's table; a later table's key wins over an earlier one's. */
const TABLES: FilterTable[] = [GIT, GH, RUST, GO, PYTHON, JS, SYSTEM, CLOUD, JVM, RUBY, PHP, DOTNET, APPLE, FORMAT]

const FILTERS: FilterTable = Object.assign({}, ...TABLES)

/** The filter for a classified command: `tool sub` first, then `tool` alone, or undefined. */
export function filterFor(c: Classified): Filter | undefined {
  return FILTERS[`${c.tool} ${c.sub}`] ?? FILTERS[c.tool]
}
