/**
 * A 4x2 GIF of two frames, written by ImageMagick: red in the left half for
 * 200 ms, then, after the first is disposed to the background, white in the
 * right half for 300 ms, from a local color table; every other pixel is
 * transparent. Pillow decodes it to the same pixels.
 */
export const TWO_FRAMES = 'R0lGODlhBAACAPAAAAAAAP8AACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJFAAAACwAAAAABAACAAACBEwAhgUAIfkECR4AAAAsAAAAAAQAAgCAAAAA////AgQEEoYFADs='

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64Of(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    const left = bytes.length - i
    out += B64[(n >> 18) & 63]
    out += B64[(n >> 12) & 63]
    out += left > 1 ? B64[(n >> 6) & 63] : '='
    out += left > 2 ? B64[n & 63] : '='
  }
  return out
}

function bytesOfFixture(): Uint8Array {
  const text = atobLike(TWO_FRAMES)
  return Uint8Array.from(text, c => c.charCodeAt(0))
}

function atobLike(b64: string): string {
  let bits = 0
  let acc = 0
  let out = ''
  for (const ch of b64.replace(/=+$/, '')) {
    acc = ((acc << 6) | B64.indexOf(ch)) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((acc >> bits) & 0xff)
    }
  }
  return out
}

/** TWO_FRAMES with comment extension blocks of 4.5 MiB in all before its trailer, as base64. */
export const BIG_GIF = ((): string => {
  const small = bytesOfFixture()
  const blocks = Math.ceil((4.5 * 1024 * 1024) / 255)
  const comment = new Uint8Array(3 + blocks * 256)
  comment.set([0x21, 0xfe], 0)
  for (let b = 0; b < blocks; b++) comment[2 + b * 256] = 255
  comment[comment.length - 1] = 0
  const out = new Uint8Array(small.length + comment.length)
  out.set(small.subarray(0, small.length - 1), 0)
  out.set(comment, small.length - 1)
  out[out.length - 1] = 0x3b
  return base64Of(out)
})()
