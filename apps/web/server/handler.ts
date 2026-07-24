import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from '@zoo/api'
import { parseServerEnv } from '@zoo/api/env'

/**
 * Source for the Vercel API function. Bundled by `server/build.mjs` into
 * `handler.bundle.mjs` and re-exported from `apps/web/api/index.js`.
 *
 * Why this custom adapter (not `hono/vercel` / not bare `getRequestListener`):
 *
 * 1. Vercel’s `/api` Node runtime always invokes `(req, res)`. A one-arg Web
 *    `Request` handler is still called that way; `app.fetch(IncomingMessage)`
 *    then hangs → 504 on every route including GET `/api`.
 *
 * 2. `@hono/node-server`’s `getRequestListener` works for GET, but on Vercel
 *    POST bodies are often already buffered on `req.body` while the
 *    IncomingMessage stream never emits `end` the way Node’s http.Server
 *    would. Waiting on that stream → 504 on `/api/auth/sign-in/*`.
 *
 * This adapter is two-arg (so Vercel routes correctly), builds a real Web
 * `Request` using `req.body` when present, and otherwise reads the stream
 * with a hard timeout so we never hang the function.
 */

const app = createApp(parseServerEnv(process.env))

type VercelRequest = IncomingMessage & {
  body?: unknown
}

const BODY_TIMEOUT_MS = 5_000
const BODY_LIMIT_BYTES = 1_000_000

function requestUrl(req: IncomingMessage): string {
  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  const protoHeader = req.headers['x-forwarded-proto']
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ?? 'https'
  return `${proto}://${host}${req.url ?? '/'}`
}

function headersFromNode(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    // Undici rejects host/connection on Request construction in some runtimes.
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

function bodyFromVercelBuffer(body: unknown): Buffer | undefined {
  if (body === undefined || body === null) return undefined
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Uint8Array) return Buffer.from(body)
  // Vercel JSON body-parser leaves a plain object — re-serialize for better-auth.
  return Buffer.from(JSON.stringify(body))
}

function readStreamWithTimeout(req: IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    if (req.readableEnded || req.complete) {
      resolve(undefined)
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const finish = (value: Buffer | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      resolve(value)
    }

    const timer = setTimeout(() => {
      // Prefer returning whatever we have over hanging the whole invocation.
      finish(chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0))
    }, BODY_TIMEOUT_MS)

    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > BODY_LIMIT_BYTES) {
        settled = true
        clearTimeout(timer)
        req.off('data', onData)
        req.off('end', onEnd)
        req.off('error', onError)
        reject(new Error('Request body too large'))
        return
      }
      chunks.push(buf)
    }

    const onEnd = () => finish(chunks.length > 0 ? Buffer.concat(chunks) : undefined)
    const onError = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

async function toWebRequest(req: VercelRequest): Promise<Request> {
  const method = req.method ?? 'GET'
  const headers = headersFromNode(req)
  const init: RequestInit = { method, headers }

  if (method !== 'GET' && method !== 'HEAD') {
    const buffered = bodyFromVercelBuffer(req.body)
    const body = buffered ?? (await readStreamWithTimeout(req))
    if (body && body.length > 0) {
      init.body = new Uint8Array(body)
      // Required by undici when sending a body from a non-browser Request.
      ;(init as RequestInit & { duplex?: 'half' }).duplex = 'half'
      if (!headers.has('content-type') && req.body !== undefined && typeof req.body !== 'string') {
        headers.set('content-type', 'application/json')
      }
    }
  }

  return new Request(requestUrl(req), init)
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return
    res.setHeader(key, value)
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  try {
    const request = await toWebRequest(req)
    const response = await app.fetch(request)
    await writeWebResponse(response, res)
  } catch (error) {
    console.error('[api] handler failed', error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          error: 'internal_error',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }
}
