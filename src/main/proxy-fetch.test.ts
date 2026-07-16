import { createServer, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchWithOptionalProxy } from './proxy-fetch'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })))
})

describe('fetchWithOptionalProxy', () => {
  it('destroys a proxied response stream when aborted after headers', async () => {
    const responseRefs: ServerResponse[] = []
    let resolveClosed: (() => void) | undefined
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
    const server = createServer((_request, response) => {
      responseRefs.push(response)
      response.on('close', () => resolveClosed?.())
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.write('first')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected proxy address')
    const controller = new AbortController()

    const response = await fetchWithOptionalProxy(
      'http://upstream.invalid/archive.tgz',
      { signal: controller.signal },
      `http://127.0.0.1:${address.port}`
    )
    const reader = response.body?.getReader()
    if (!reader) throw new Error('expected response body')
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')

    controller.abort()
    await Promise.race([
      closed,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('proxied response stayed open after abort')), 500)
      })
    ])

    expect(responseRefs[0]?.destroyed).toBe(true)
  })
})
