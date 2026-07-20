import { basename } from 'path'
import type { GitHubStorageConfig, StorageFile } from '@shared/types'
import type { StorageProvider } from '../StorageProvider'

const GITHUB_REQUEST_TIMEOUT_MS = 30_000
const GITHUB_MAX_ATTEMPTS = 3
const GITHUB_RETRY_DELAYS_MS = [800, 2_000]

interface GitHubContentEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  sha?: string
  content?: string
  encoding?: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelay(attempt: number): number {
  return GITHUB_RETRY_DELAYS_MS[attempt - 1] ?? GITHUB_RETRY_DELAYS_MS[GITHUB_RETRY_DELAYS_MS.length - 1]
}

export class GitHubProvider implements StorageProvider {
  name = 'github'
  private config: GitHubStorageConfig | null = null

  async connect(config: unknown): Promise<void> {
    const parsed = config as Partial<GitHubStorageConfig>
    if (!parsed.owner || !parsed.repo) {
      throw new Error('GitHub owner and repo are required')
    }
    this.config = {
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.branch || 'main',
      basePath: parsed.basePath || '',
      token: parsed.token || ''
    }
    await this.request(`/repos/${this.config.owner}/${this.config.repo}`)
  }

  async list(path: string): Promise<StorageFile[]> {
    const entry = await this.getContent(path)
    const entries = Array.isArray(entry) ? entry : [entry]
    return entries.map((item) => ({
      name: item.name,
      path: this.stripBasePath(item.path),
      type: item.type === 'dir' ? 'directory' : 'file',
      size: item.type === 'dir' ? 0 : item.size ?? 0,
      updatedAt: 0,
      etag: item.sha
    }))
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = await this.getContent(path)
    if (Array.isArray(entry) || entry.type !== 'file') {
      throw new Error(`GitHub path is not a file: ${path}`)
    }
    if (entry.encoding === 'base64' && entry.content) {
      return Buffer.from(entry.content.replace(/\n/g, ''), 'base64')
    }
    return this.getRawContent(path)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.requireWriteToken()
    const sha = await this.getShaIfExists(path)
    await this.request(this.contentsEndpoint(path), {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update ${path}`,
        content: Buffer.from(data).toString('base64'),
        branch: this.config!.branch,
        ...(sha ? { sha } : {})
      })
    })
  }

  async delete(path: string): Promise<void> {
    this.requireWriteToken()
    const sha = await this.getShaIfExists(path)
    if (!sha) return
    await this.request(this.contentsEndpoint(path), {
      method: 'DELETE',
      body: JSON.stringify({
        message: `Delete ${path}`,
        sha,
        branch: this.config!.branch
      })
    })
  }

  async move(from: string, to: string): Promise<void> {
    const data = await this.read(from)
    await this.write(to, data)
    await this.delete(from)
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.getContent(path)
      return true
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return false
      throw err
    }
  }

  private async getShaIfExists(path: string): Promise<string | null> {
    try {
      const entry = await this.getContent(path)
      if (Array.isArray(entry) || entry.type !== 'file') return null
      return entry.sha ?? null
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null
      throw err
    }
  }

  private async getContent(path: string): Promise<GitHubContentEntry | GitHubContentEntry[]> {
    return this.request<GitHubContentEntry | GitHubContentEntry[]>(
      `${this.contentsEndpoint(path)}?ref=${encodeURIComponent(this.config!.branch)}`
    )
  }

  private async getRawContent(path: string): Promise<Uint8Array> {
    const data = await this.requestBytes(
      `${this.contentsEndpoint(path)}?ref=${encodeURIComponent(this.config!.branch)}`,
      {
        headers: {
          Accept: 'application/vnd.github.raw+json'
        }
      }
    )
    return new Uint8Array(data)
  }

  private contentsEndpoint(path: string): string {
    const cfg = this.requireConfig()
    const providerPath = this.withBasePath(path)
    const encoded = providerPath
      .split('/')
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/')
    const suffix = encoded ? `/contents/${encoded}` : '/contents'
    return `/repos/${cfg.owner}/${cfg.repo}${suffix}`
  }

  private async request<T = unknown>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(endpoint, init)
    return response.json() as Promise<T>
  }

  private async requestBytes(endpoint: string, init: RequestInit = {}): Promise<ArrayBuffer> {
    const response = await this.fetch(endpoint, init)
    return response.arrayBuffer()
  }

  private async fetch(endpoint: string, init: RequestInit = {}): Promise<Response> {
    const cfg = this.requireConfig()
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`

    let lastError: unknown
    for (let attempt = 1; attempt <= GITHUB_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(`https://api.github.com${endpoint}`, {
          ...init,
          signal: init.signal ?? controller.signal,
          headers: {
            ...headers,
            ...(init.headers as Record<string, string> | undefined)
          }
        })

        clearTimeout(timeout)
        if (!response.ok) {
          const body = await response.text()
          const error = new Error(`GitHub ${response.status}: ${body}`)
          if (attempt < GITHUB_MAX_ATTEMPTS && this.shouldRetryResponse(response.status)) {
            lastError = error
            await delay(retryDelay(attempt))
            continue
          }
          throw error
        }
        return response
      } catch (err) {
        clearTimeout(timeout)
        lastError = err
        if (attempt >= GITHUB_MAX_ATTEMPTS || !this.shouldRetryError(err)) {
          throw err
        }
        await delay(retryDelay(attempt))
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private shouldRetryResponse(status: number): boolean {
    return status === 408 || status === 429 || status >= 500
  }

  private shouldRetryError(err: unknown): boolean {
    return this.errorMatches(err, /\b(fetch failed|network|timeout|timedout|abort|aborted|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|socket)\b/i)
  }

  private errorMatches(err: unknown, pattern: RegExp): boolean {
    if (!err) return false
    if (typeof err === 'string') return pattern.test(err)

    if (err instanceof AggregateError) {
      return err.errors.some((item) => this.errorMatches(item, pattern))
    }

    if (err instanceof Error) {
      if (pattern.test(`${err.name} ${err.message}`)) return true
      return this.errorMatches((err as Error & { cause?: unknown }).cause, pattern)
    }

    if (typeof err === 'object') {
      const code = (err as { code?: unknown }).code
      if (code && pattern.test(String(code))) return true
      const cause = (err as { cause?: unknown }).cause
      if (cause) return this.errorMatches(cause, pattern)
    }

    return pattern.test(String(err))
  }

  private withBasePath(path: string): string {
    const cfg = this.requireConfig()
    const base = cfg.basePath.replace(/^\/+|\/+$/g, '')
    const cleanPath = path.replace(/^\/+|\/+$/g, '')
    return [base, cleanPath].filter(Boolean).join('/')
  }

  private stripBasePath(path: string): string {
    const cfg = this.requireConfig()
    const base = cfg.basePath.replace(/^\/+|\/+$/g, '')
    if (!base) return path
    if (path === base) return basename(path)
    return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
  }

  private requireConfig(): GitHubStorageConfig {
    if (!this.config) throw new Error('GitHubProvider is not connected')
    return this.config
  }

  private requireWriteToken(): void {
    if (!this.requireConfig().token) {
      throw new Error('GitHub token is required for write/delete operations')
    }
  }
}
