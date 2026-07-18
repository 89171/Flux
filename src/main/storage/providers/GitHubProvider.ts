import { basename } from 'path'
import type { GitHubStorageConfig, StorageFile } from '@shared/types'
import type { StorageProvider } from '../StorageProvider'

interface GitHubContentEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  sha?: string
  content?: string
  encoding?: string
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
    if (entry.encoding !== 'base64' || !entry.content) {
      throw new Error(`GitHub content is not base64 encoded: ${path}`)
    }
    return Buffer.from(entry.content.replace(/\n/g, ''), 'base64')
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
    const cfg = this.requireConfig()
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`

    const response = await fetch(`https://api.github.com${endpoint}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers as Record<string, string> | undefined)
      }
    })
    if (!response.ok) {
      throw new Error(`GitHub ${response.status}: ${await response.text()}`)
    }
    return response.json() as Promise<T>
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
