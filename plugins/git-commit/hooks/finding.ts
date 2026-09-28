/**
 * One rule a git command broke. A `deny` finding stops the command in the
 * `deny` mode and reaches the model as a note in the `note` mode; a `note`
 * finding is a heuristic and only ever reaches the model as a note.
 * `short` is the person's line, `text` the model's.
 */
export type Finding = { level: 'deny' | 'note'; short: string; text: string }

export function deny(short: string, text: string): Finding {
  return { level: 'deny', short, text }
}

export function note(short: string, text: string): Finding {
  return { level: 'note', short, text }
}
