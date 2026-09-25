import { collapseBlanks, collapseRepeats, linesOf, type Filter, type FilterResult } from './common.ts'

/**
 * The filter for a command no table names, and for a chain of several commands: it removes terminal
 * escapes and progress redraws, folds repeated lines into one with a count, and keeps one blank line of
 * each run. It drops no line of content, so it needs no full-output file.
 */
export function cleanup(text: string): FilterResult {
  return { text: collapseBlanks(collapseRepeats(linesOf(text))).join('\n'), elided: false }
}

export const GENERIC: Filter = { run: ({ text }) => cleanup(text) }
