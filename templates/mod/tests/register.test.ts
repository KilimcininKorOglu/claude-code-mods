import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

describe('register', () => {
  test('reports that the mod loaded', async ($, on) => {
    const lines: string[] = []
    on('ui.log', ($, e) => {
      lines.push(e.text)
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    expect(lines).toContain('MOD_NAME loaded in /work')
  })
})
