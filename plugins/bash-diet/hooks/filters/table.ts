/**
 * A column table as `docker ps`, `docker images` and `kubectl get` print it: the header names the columns,
 * each starting where its name starts, and a cell may hold single spaces (`11 hours ago`).
 */

type Column = { name: string; start: number; end: number }

/** The columns of a header line: names separated by two spaces or more. */
function columnsOf(header: string): Column[] {
  const cols: Column[] = []
  const re = /\S+(?: \S+)*/g
  for (let m = re.exec(header); m !== null; m = re.exec(header)) cols.push({ name: m[0], start: m.index, end: header.length })
  cols.forEach((c, i) => { c.end = cols[i + 1]?.start ?? Number.MAX_SAFE_INTEGER })
  return cols
}

/** One row's cell under each column. */
function cellsOf(row: string, cols: Column[]): Record<string, string> {
  return Object.fromEntries(cols.map((c, i) => [c.name, row.slice(c.start, i === cols.length - 1 ? undefined : c.end).trim()]))
}

/** The header line: the first line whose words are all capitals, allowing spaces inside a column name. */
const isHeader = (line: string): boolean => /^[A-Z][A-Z ()/-]+$/.test(line.trim()) && /\S {2,}\S/.test(line)

/**
 * The table's rows as the chosen columns, those the header has, joined by two spaces; undefined when no
 * header is found. The first column that exists names the row.
 */
export function pickColumns(lines: string[], wanted: string[]): { rows: string[]; header: string } | undefined {
  const at = lines.findIndex(isHeader)
  if (at < 0) return undefined
  const cols = columnsOf(lines[at] ?? '')
  const names = wanted.filter(w => cols.some(c => c.name === w))
  if (names.length === 0) return undefined
  const rows = lines.slice(at + 1).filter(l => l.trim() !== '').map(l => {
    const cells = cellsOf(l, cols)
    return names.map(n => cells[n] ?? '').filter(v => v !== '').join('  ')
  })
  return { rows, header: names.join('  ') }
}
