/** The pane /gemini-core model <mod> opens: the models the key lists, to pick one for a mod. */
import type { Elements } from 'claude-code'
import type { ModelInfo } from './models.ts'

/** The pick the pane is open for. */
export type Pick = { consumer: string; models: readonly ModelInfo[]; current: string }

export const PANE_ID = 'gemini-core-model'

/** The pane's rows: the hint, and the list the picker draws one model per row. */
export function paneRows(models: readonly ModelInfo[]): number {
  return Math.min(models.length, 20) + 2
}

function label(m: ModelInfo): string {
  return `${m.id}${m.thinking ? '' : ' (no thinking)'}`
}

/** A Select over the models, the mod's current model selected. */
export function pickerTree(els: Elements['terminal' | 'desktop' | 'vscode'], pick: Pick, onPick: (model: string) => void) {
  const { Box, Select, Text } = els
  const options = pick.models.map(m => ({ value: m.id, label: label(m) }))
  const value = pick.models.some(m => m.id === pick.current) ? pick.current : undefined
  return (
    <Box flexDirection="column">
      <Text dimColor>{`Enter sets the model of ${pick.consumer}; Esc closes without a change.`}</Text>
      <Select key="model" label="model" options={options} {...(value === undefined ? {} : { value })} autoFocus onSelect={onPick} />
    </Box>
  )
}

/** Where a surface has no Select: the list, and the command that sets one. */
export function listTree(els: Elements['mobile'], pick: Pick) {
  const { Box, Text } = els
  return (
    <Box flexDirection="column">
      <Text dimColor>{`/gemini-core model ${pick.consumer} <id> sets one of:`}</Text>
      {pick.models.map(m => <Text key={m.id}>{label(m)}</Text>)}
    </Box>
  )
}
