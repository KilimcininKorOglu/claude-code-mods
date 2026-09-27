/**
 * Where sage-memory keeps its files under its own directory (`<config dir>/sage-memory`). Pure
 * string code, imported by the hooks module and the daemon.
 */

export type Layout = {
  dir: string
  socket: string
  serverFile: string
  /** Held while a daemon decides whether it takes the socket, so two never take it at once. */
  lockFile: string
  logFile: string
  globalDb: string
  /** What `/sage-memory setup` installs: the embedding package under `node_modules`, and its model under `models`. */
  runtimeDir: string
  modelsDir: string
}

/** The longest socket path `$.http.fetch` takes ("near 100 B at most"), below the OS limits too. */
export const MAX_SOCKET_BYTES = 100

export function layoutOf(dir: string): Layout {
  return {
    dir,
    socket: `${dir}/daemon.sock`,
    serverFile: `${dir}/server.json`,
    lockFile: `${dir}/daemon.lock`,
    logFile: `${dir}/daemon.log`,
    globalDb: `${dir}/global.db`,
    runtimeDir: `${dir}/runtime`,
    modelsDir: `${dir}/runtime/models`,
  }
}

/** The directory of one project's store. */
export function projectDirOf(dir: string, key: string): string {
  return `${dir}/${key}`
}

const PROJECT_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** A project key is one path segment of safe characters, never `..`. */
export function isProjectKey(key: string): boolean {
  return PROJECT_KEY.test(key) && !key.includes('..')
}

/** The UTF-8 length of a string, counted per code point. */
export function utf8Bytes(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}
