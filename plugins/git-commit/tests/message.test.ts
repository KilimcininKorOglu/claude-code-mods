import { describe, expect, test, tier } from 'claude-code/testing'

import { gitCalls, heredocsOf } from '../hooks/command.ts'
import { commitArgs } from '../hooks/gitargs.ts'
import { messageFindings, messageOf, signatureLine, styleOf, type Message } from '../hooks/message.ts'

tier('user')

/** The message of the first commit in a command. */
function messageIn(command: string, fileText?: string): Message {
  const call = gitCalls(command).find(c => c.sub === 'commit')
  return messageOf(commitArgs(call?.args ?? []), heredocsOf(command), new Set(), fileText)
}

const conventional = styleOf(['feat(a): add x', 'fix: stop y', 'docs(b): note z', 'chore: bump'])
const plain = styleOf(['Add x', 'Fix y', 'Update the docs'])

describe('messageOf', () => {
  test('reads -m values joined as paragraphs', async () => {
    expect(messageIn('git commit -m "fix: a" -m "why it broke"')).toEqual({ text: 'fix: a\n\nwhy it broke' })
  })

  test('reads the heredoc body of a $(cat <<EOF) message', async () => {
    const command = 'git add a && git commit -m "$(cat <<\'EOF\'\nfix(x): handle y\n\nBody line.\nEOF\n)"'
    expect(messageIn(command)).toEqual({ text: 'fix(x): handle y\n\nBody line.' })
  })

  test('reads -F - from the heredoc on its own line, and -F <file> from the text the caller read', async () => {
    expect(messageIn("git commit -F - <<'MSG'\ndocs: a\nMSG")).toEqual({ text: 'docs: a' })
    expect(messageIn('git commit -F msg.txt', 'test: b\n')).toEqual({ text: 'test: b\n' })
    expect(messageIn('git commit -F msg.txt')).toEqual({ unknown: 'the message file msg.txt was not read' })
  })

  test('adds --trailer values, since git appends them to the message', async () => {
    expect(messageIn('git commit -m "fix: a" --trailer "Co-authored-by: Claude <x>"')).toEqual({ text: 'fix: a\n\nCo-authored-by: Claude <x>' })
  })

  test('says why a message cannot be read', async () => {
    expect('unknown' in messageIn('git commit -m "$MSG"')).toBe(true)
    expect('unknown' in messageIn('git commit -C HEAD')).toBe(true)
    expect('unknown' in messageIn('git commit --amend --no-edit')).toBe(true)
    expect('unknown' in messageIn('git commit')).toBe(true)
  })
})

describe('styleOf', () => {
  test('calls a repository conventional when most of three or more subjects are', async () => {
    expect(conventional.isConventional).toBe(true)
    expect(conventional.lowercase).toBe(true)
    expect(plain.isConventional).toBe(false)
    expect(styleOf(['fix: a', 'feat: b']).isConventional).toBe(false)
  })
})

describe('signatureLine', () => {
  test('finds AI signature lines and leaves human trailers alone', async () => {
    expect(signatureLine('fix: a\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')).toBe('Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')
    expect(signatureLine('fix: a\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')).toBe('🤖 Generated with [Claude Code](https://claude.com/claude-code)')
    expect(signatureLine('feat: a\n\nCreated by AI')).toBe('Created by AI')
    expect(signatureLine('fix: a\n\nCo-authored-by: Jane Doe <jane@maintain.io>')).toBe(undefined)
    expect(signatureLine('fix: a\n\nSigned-off-by: Jane Doe <jane@x.io>')).toBe(undefined)
  })
})

describe('messageFindings', () => {
  const rules = (text: string, style = conventional) => messageFindings(text, style).map(f => `${f.level}:${f.short}`)

  test('passes a message that follows the skill and the repository', async () => {
    expect(rules('feat(parser): add a flag\n\nWhy it matters.')).toEqual([])
    expect(rules('Add a flag', plain)).toEqual([])
  })

  test('stops the hard rules of the first line and the signature', async () => {
    expect(rules(`fix: ${'x'.repeat(70)}`)).toEqual(['deny:subject over 72 characters'])
    expect(rules('fix: stop the leak.')).toEqual(['deny:subject ends with a period'])
    expect(rules('\nbody only')).toEqual(['deny:empty subject'])
    expect(rules('fix: a\n\nCo-authored-by: GPT <x>')).toEqual(['deny:AI signature in the message'])
  })

  test('holds a conventional repository to type(scope): subject and the skill\'s types', async () => {
    expect(rules('Add a flag')).toEqual(['deny:subject is not type(scope): subject'])
    expect(rules('feature: add a flag')).toEqual(['deny:unknown type feature'])
    expect(rules('deps-add(x): pull in y')).toEqual([])
  })

  test('only notes the case and the mood', async () => {
    expect(rules('fix: Stop the leak')).toEqual(['note:subject case'])
    expect(rules('fix: added a guard')).toEqual(['note:subject not imperative'])
    expect(rules('feat: embed the font')).toEqual([])
  })
})
