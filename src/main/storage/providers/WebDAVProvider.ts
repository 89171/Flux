import { basename } from 'path'
import type { StorageFile, WebDAVStorageConfig } from '@shared/types'
import type { StorageProvider } from '../StorageProvider'

export class WebDAVProvider implements StorageProvider {
  name = 'webdav'
  private config: WebDAVStorageConfig | null = null

  async connect(config: unknown): Promise<void> {
    const parsed = config as Partial<WebDAVStorageConfig>
    if (!parsed.endpoint) throw new Error('WebDAV endpoint is required')
    this.config = {
      endpoint: parsed.endpoint.replace(/\/+$/g, ''),
      username: parsed.username || '',
      password: parsed.password || '',
      basePath: parsed.basePath || ''
    }
    await this.request('', { method: 'OPTIONS' })
  }

  async list(path: string): Promise<StorageFile[]> {
    const response = await this.request(path, {
      method: 'PROPFIND',
      headers: { Depth: '1' }
    })
    const xml = await response.text()
    return this.parsePropfind(xml, path)
  }

  async read(path: string): Promise<Uint8Array> {
    const response = await this.request(path, { method: 'GET' })
    return new Uint8Array(await response.arrayBuffer())
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await this.ensureParentDirectories(path)
    await this.request(path, {
      method: 'PUT',
      body: Buffer.from(data)
    })
  }

  async delete(path: string): Promise<void> {
    await this.request(path, { method: 'DELETE' }, [200, 202, 204, 404])
  }

  async move(from: string, to: string): Promise<void> {
    await this.ensureParentDirectories(to)
    await this.request(from, {
      method: 'MOVE',
      headers: {
        Destination: this.urlFor(to),
        Overwrite: 'T'
      }
    })
  }

  async exists(path: string): Promise<boolean> {
    const response = await this.request(
      path,
      {
        method: 'PROPFIND',
        headers: { Depth: '0' }
      },
      [200, 207, 404]
    )
    return response.status !== 404
  }

  private async ensureParentDirectories(path: string): Promise<void> {
    const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
    parts.pop()
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      await this.request(current, { method: 'MKCOL' }, [201, 405])
    }
  }

  private parsePropfind(xml: string, requestedPath: string): StorageFile[] {
    const requested = this.normalizeProviderPath(requestedPath)
    const responses = xml.match(/<[^:>]*:?response[\s\S]*?<\/[^:>]*:?response>/g) ?? []
    const files: StorageFile[] = []

    for (const response of responses) {
      const href = this.firstXmlText(response, 'href')
      if (!href) continue
      const providerPath = this.providerPathFromHref(href)
      if (!providerPath || providerPath === requested) continue

      const name = basename(providerPath)
      const isDir = /<[^:>]*:?collection\s*\/?>/.test(response)
      const size = Number(this.firstXmlText(response, 'getcontentlength') ?? '0')
      const modified = Date.parse(this.firstXmlText(response, 'getlastmodified') ?? '')
      const etag = this.firstXmlText(response, 'getetag')?.replace(/^"|"$/g, '')
      files.push({
        name,
        path: providerPath,
        type: isDir ? 'directory' : 'file',
        size: Number.isFinite(size) ? size : 0,
        updatedAt: Number.isFinite(modified) ? modified : 0,
        etag
      })
    }

    files.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
    return files
  }

  private firstXmlText(xml: string, localName: string): string | null {
    const match = xml.match(new RegExp(`<[^:>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${localName}>`, 'i'))
    return match?.[1]?.trim() ?? null
  }

  private providerPathFromHref(href: string): string {
    const cfg = this.requireConfig()
    const endpointPath = new URL(cfg.endpoint).pathname.replace(/\/+$/g, '')
    const hrefPath = decodeURIComponent(new URL(href, cfg.endpoint).pathname)
    const base = cfg.basePath.replace(/^\/+|\/+$/g, '')
    let providerPath = hrefPath
    if (endpointPath && providerPath.startsWith(endpointPath)) {
      providerPath = providerPath.slice(endpointPath.length)
    }
    providerPath = providerPath.replace(/^\/+|\/+$/g, '')
    if (base && providerPath.startsWith(`${base}/`)) {
      providerPath = providerPath.slice(base.length + 1)
    }
    return providerPath
  }

  private async request(
    path: string,
    init: RequestInit,
    okStatuses: number[] = [200, 201, 204, 207]
  ): Promise<Response> {
    const cfg = this.requireConfig()
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined)
    }
    if (cfg.username || cfg.password) {
      headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`
    }
    const response = await fetch(this.urlFor(path), {
      ...init,
      headers
    })
    if (!okStatuses.includes(response.status)) {
      throw new Error(`WebDAV ${response.status}: ${await response.text()}`)
    }
    return response
  }

  private urlFor(path: string): string {
    const cfg = this.requireConfig()
    const providerPath = this.normalizeProviderPath(path)
    const base = cfg.basePath.replace(/^\/+|\/+$/g, '')
    const joined = [base, providerPath].filter(Boolean).join('/')
    const encoded = joined
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/')
    return encoded ? `${cfg.endpoint}/${encoded}` : cfg.endpoint
  }

  private normalizeProviderPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  }

  private requireConfig(): WebDAVStorageConfig {
    if (!this.config) throw new Error('WebDAVProvider is not connected')
    return this.config
  }
}
