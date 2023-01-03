import fetch, { Headers, Request, Response } from 'cross-fetch'

// Forcedly overwrite `globalThis.fetch` to enable msw
// https://github.com/node-fetch/node-fetch#providing-global-access
// https://github.com/mswjs/msw/discussions/1296
// IMPORTANT ->
// https://github.com/mswjs/msw/issues/1388
const globalThisAny: any = globalThis
globalThisAny.fetch = fetch
globalThisAny.Headers = Headers
globalThisAny.Request = Request
globalThisAny.Response = Response
