/**
 * Runs one call to one node with its own abort signal and a budget of
 * `timeoutMs`. Past the budget it aborts the call and rejects with a
 * `TimeoutError`, so a node that accepts the connection and never answers
 * cannot hold the caller open. The race does not rely on the transport to
 * honour the abort, and the `finally` clears the timer on every exit.
 *
 * A timeout says nothing about the transaction: it is never a "not found",
 * so the outcome stays unknown.
 *
 * The gRPC `timeout` call option is not enough: the gRPC-web transport only
 * sends it as the `grpc-timeout` header, which a node that never answers
 * ignores. Not `AbortSignal.timeout`: a published SDK should not raise its
 * runtime floor for it.
 */
export async function callWithinDeadline<T>(
  call: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = createTimeoutError(timeoutMs)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      // A synchronous throw of `call` becomes a rejection too.
      new Promise<T>((resolve) => resolve(call(controller.signal))),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The name makes the gRPC transport report the abort as DEADLINE_EXCEEDED,
 * as for any timeout.
 */
function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(`The Sui node did not answer within ${timeoutMs} ms.`)
  error.name = 'TimeoutError'
  return error
}
