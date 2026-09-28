/**
 * The memory manager pane: a search, a scope and a status filter, pages of 30 memories, the chosen
 * memory's detail with its buttons, and a view of the pending candidates. Pure drawing; the
 * handlers come from `register.tsx`, which asks the daemon.
 */
import type { Elements } from 'claude-code'
import { candidatesText, detailText } from './commands.ts'
import type { Candidate, Memory, Scope, Status } from './shared/model.ts'

export const PANE_ID = 'sage-memory'
export const PAGE_SIZE = 30

export type StatusFilter = 'live' | Status
export type ScopeFilter = 'all' | Scope

/** What the pane shows; the page's memories and candidates are the daemon's last answer. */
export type PaneState = {
  view: 'memories' | 'candidates'
  query: string
  scope: ScopeFilter
  status: StatusFilter
  /** The cursors of the pages before this one, so `previous` can go back. */
  cursors: (string | undefined)[]
  cursor?: string
  next?: string
  total: number
  memories: Memory[]
  candidates: Candidate[]
  selected?: string
  /** The memory whose delete button was pressed once; a second press deletes it. */
  armed?: string
  message?: string
  busy: boolean
}

export function emptyPane(): PaneState {
  return { view: 'memories', query: '', scope: 'all', status: 'live', cursors: [], total: 0, memories: [], candidates: [], busy: false }
}

/** The statuses a filter lists: `live` is active and stale. */
export function statusesOf(filter: StatusFilter): Status[] {
  return filter === 'live' ? ['active', 'stale'] : [filter]
}

export type PaneAction = 'stale' | 'active' | 'archive' | 'permanent' | 'delete' | 'recover'
export type CandidateAction = 'accept' | 'reject' | 'delete' | 'archive' | 'keep'

export type Handlers = {
  search: (query: string) => void
  scope: (scope: ScopeFilter) => void
  status: (status: StatusFilter) => void
  page: (step: 1 | -1) => void
  select: (id: string) => void
  act: (action: PaneAction) => void
  view: (view: PaneState['view']) => void
  candidate: (id: string, action: CandidateAction) => void
}

const SCOPE_OPTIONS: ScopeFilter[] = ['all', 'project', 'user', 'session', 'file', 'symbol']
const STATUS_OPTIONS: StatusFilter[] = ['live', 'active', 'stale', 'superseded', 'contradicted', 'archived', 'deleted']

/** The buttons a memory takes: one per change its status and settings allow. */
export function actionsFor(m: Memory, armed: boolean): { action: PaneAction; label: string }[] {
  if (m.status === 'deleted') return [{ action: 'recover', label: 'recover' }]
  const actions: { action: PaneAction; label: string }[] = []
  if (m.status !== 'stale') actions.push({ action: 'stale', label: 'mark stale' })
  if (m.status !== 'active') actions.push({ action: 'active', label: 'make active' })
  if (m.status !== 'archived') actions.push({ action: 'archive', label: 'archive' })
  actions.push({ action: 'permanent', label: m.persistence === 'permanent' ? 'not permanent' : 'permanent' })
  actions.push({ action: 'delete', label: armed ? 'press again to delete' : 'delete' })
  return actions
}

/** The change a button writes as an update, or nothing for delete and recover, which have routes of their own. */
export function patchFor(m: Memory, action: PaneAction): Partial<Memory> | undefined {
  if (action === 'stale') return { status: 'stale', staleReason: 'manual' }
  if (action === 'active') return { status: 'active' }
  if (action === 'archive') return { status: 'archived' }
  if (action === 'permanent') return { persistence: m.persistence === 'permanent' ? 'long_lived' : 'permanent' }
  return undefined
}

/** The list request of the pane's filters and page. */
export function listBody(pane: PaneState): Record<string, unknown> {
  return {
    query: pane.query === '' ? undefined : pane.query,
    scope: pane.scope === 'all' ? undefined : pane.scope,
    statuses: statusesOf(pane.status),
    limit: PAGE_SIZE,
    cursor: pane.cursor,
    allSessions: true,
  }
}

/** A new search or filter starts at the first page with nothing chosen. */
export function refilter(pane: PaneState, change: Partial<Pick<PaneState, 'query' | 'scope' | 'status'>>): void {
  Object.assign(pane, change, { cursor: undefined, cursors: [], selected: undefined, armed: undefined })
}

/** Moves one page on (while there is a next one) or back (while there was one before). */
export function turnPage(pane: PaneState, step: 1 | -1): void {
  if (step === 1 && pane.next !== undefined) {
    pane.cursors.push(pane.cursor)
    pane.cursor = pane.next
  }
  if (step === -1 && pane.cursors.length > 0) pane.cursor = pane.cursors.pop()
  pane.selected = undefined
  pane.armed = undefined
}

function rowLabel(m: Memory, width: number): string {
  const text = `${m.status === 'active' ? ' ' : m.status[0]} ${m.scope.padEnd(7)} ${m.text.replace(/\s+/g, ' ')}`
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`
}

type Els = Elements[keyof Elements]

function filters(els: Els, pane: PaneState, on: Handlers) {
  const { Box, Button } = els
  const Input = 'Input' in els ? els.Input : undefined
  const Select = 'Select' in els ? els.Select : undefined
  return (
    <Box flexDirection="row" gap={1}>
      {Input === undefined ? null : <Input key="search" placeholder="search" value={pane.query} submitLabel="search" onSubmit={value => on.search(value)} />}
      {Select === undefined ? null : <Select key="scope" label="scope" value={pane.scope} options={SCOPE_OPTIONS.map(v => ({ value: v, label: v }))} onSelect={value => on.scope(value as ScopeFilter)} />}
      {Select === undefined ? null : <Select key="status" label="status" value={pane.status} options={STATUS_OPTIONS.map(v => ({ value: v, label: v }))} onSelect={value => on.status(value as StatusFilter)} />}
      <Button key="candidates" label="candidates" onPress={() => on.view('candidates')} />
    </Box>
  )
}

function detail(els: Els, pane: PaneState, on: Handlers) {
  const { Box, Button, Text } = els
  const chosen = pane.memories.find(m => m.id === pane.selected)
  if (chosen === undefined) return <Text dimColor>Enter on a row shows the memory and its buttons.</Text>
  return (
    <Box flexDirection="column">
      <Text>{detailText(chosen)}</Text>
      <Box flexDirection="row" gap={1}>
        {actionsFor(chosen, pane.armed === chosen.id).map(({ action, label }) => (
          <Button key={`act:${action}`} label={label} onPress={() => on.act(action)} />
        ))}
      </Box>
    </Box>
  )
}

function memoriesView(els: Els, pane: PaneState, on: Handlers, width: number) {
  const { Box, Button, Text } = els
  const first = pane.cursors.length * PAGE_SIZE
  return (
    <Box flexDirection="column">
      {filters(els, pane, on)}
      <Text dimColor>{`${pane.total} memories · ${pane.memories.length === 0 ? 'none here' : `${first + 1}-${first + pane.memories.length}`}${pane.busy ? ' · working…' : ''}${pane.message !== undefined ? ` · ${pane.message}` : ''}`}</Text>
      {pane.memories.map((m, i) => (
        <Button key={`row:${m.id}`} plain {...(i === 0 ? { autoFocus: true as const } : {})} label={`${pane.selected === m.id ? '>' : ' '} ${rowLabel(m, width - 4)}`} onPress={() => on.select(m.id)} />
      ))}
      <Box flexDirection="row" gap={1}>
        {pane.cursors.length > 0 ? <Button key="previous" label="previous" onPress={() => on.page(-1)} /> : null}
        {pane.next !== undefined ? <Button key="next" label="next" onPress={() => on.page(1)} /> : null}
      </Box>
      {detail(els, pane, on)}
    </Box>
  )
}

const CANDIDATE_ACTIONS: CandidateAction[] = ['accept', 'reject', 'delete', 'archive', 'keep']

function candidatesView(els: Els, pane: PaneState, on: Handlers) {
  const { Box, Button, Text } = els
  const chosen = pane.candidates.find(c => c.id === pane.selected)
  const actions = chosen?.kind === 'memory_review' ? CANDIDATE_ACTIONS.filter(a => a !== 'accept') : ['accept' as const, 'reject' as const]
  return (
    <Box flexDirection="column">
      <Button key="memories" label="back to memories" autoFocus onPress={() => on.view('memories')} />
      <Text dimColor>{`${pane.candidates.length} pending candidate(s)${pane.message !== undefined ? ` · ${pane.message}` : ''}`}</Text>
      {pane.candidates.map(c => (
        <Button key={`cand:${c.id}`} plain label={`${pane.selected === c.id ? '>' : ' '} ${candidatesText([c])}`} onPress={() => on.select(c.id)} />
      ))}
      {chosen === undefined ? null : (
        <Box flexDirection="row" gap={1}>
          {actions.map(action => (
            <Button key={`cact:${action}`} label={action} onPress={() => on.candidate(chosen.id, action)} />
          ))}
        </Box>
      )}
    </Box>
  )
}

export function paneTree(els: Els, pane: PaneState, on: Handlers, width: number) {
  return pane.view === 'memories' ? memoriesView(els, pane, on, width) : candidatesView(els, pane, on)
}
