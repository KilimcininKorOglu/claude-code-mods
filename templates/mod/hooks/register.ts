import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    $.ui.log(`MOD_NAME loaded in ${e.cwd}`)
    return r
  })
}
