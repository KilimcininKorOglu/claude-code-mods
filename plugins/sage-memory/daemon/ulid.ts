import { randomBytes } from 'node:crypto'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A ULID: 10 characters of milliseconds, then 16 random ones, in Crockford base 32. */
export function ulid(now: number = Date.now()): string {
  let time = ''
  let rest = now
  for (let i = 0; i < 10; i++) {
    time = `${CROCKFORD[rest % 32]}${time}`
    rest = Math.floor(rest / 32)
  }
  // 256 is a multiple of 32, so every character is equally likely.
  const random = [...randomBytes(16)].map(byte => CROCKFORD[byte % 32]).join('')
  return `${time}${random}`
}
