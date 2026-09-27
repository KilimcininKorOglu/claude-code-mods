/** A failure the daemon answers with its own HTTP status, and its message as the error text. */
export class RequestError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The request asks for something the rules refuse. */
export function refused(message: string): RequestError {
  return new RequestError(400, message)
}

/** The caller may not touch this record, such as another session's session memory. */
export function forbidden(message: string): RequestError {
  return new RequestError(403, message)
}

export function notFound(message: string): RequestError {
  return new RequestError(404, message)
}

/** The request is valid, but the state it meets does not allow it. */
export function conflict(message: string): RequestError {
  return new RequestError(409, message)
}
