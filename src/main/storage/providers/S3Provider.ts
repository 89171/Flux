import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from '@aws-sdk/client-s3'
import { basename, posix } from 'path'
import type { S3StorageConfig, StorageFile } from '@shared/types'
import type { StorageProvider } from '../StorageProvider'

export class S3Provider implements StorageProvider {
  name = 's3'
  private config: S3StorageConfig | null = null
  private client: S3Client | null = null

  async connect(config: unknown): Promise<void> {
    const parsed = config as Partial<S3StorageConfig>
    if (!parsed.bucket) throw new Error('S3 bucket is required')
    if ((parsed.accessKeyId && !parsed.secretAccessKey) || (!parsed.accessKeyId && parsed.secretAccessKey)) {
      throw new Error('Both S3 Access Key ID and Secret Access Key are required')
    }

    this.config = {
      endpoint: parsed.endpoint || '',
      region: parsed.region || 'us-east-1',
      bucket: parsed.bucket,
      accessKeyId: parsed.accessKeyId || '',
      secretAccessKey: parsed.secretAccessKey || '',
      basePath: parsed.basePath || '',
      forcePathStyle: !!parsed.forcePathStyle
    }
    this.client = new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint || undefined,
      forcePathStyle: this.config.forcePathStyle,
      credentials: this.config.accessKeyId
        ? {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey
          }
        : undefined
    })

    await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: this.directoryPrefix(''),
        MaxKeys: 1
      })
    )
  }

  async list(path: string): Promise<StorageFile[]> {
    const cfg = this.requireConfig()
    const client = this.requireClient()
    const prefix = this.directoryPrefix(path)
    const directories = new Map<string, StorageFile>()
    const files = new Map<string, StorageFile>()
    let token: string | undefined

    do {
      const output = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: token
        })
      )

      for (const commonPrefix of output.CommonPrefixes ?? []) {
        if (!commonPrefix.Prefix) continue
        const providerPath = this.stripBasePath(commonPrefix.Prefix.replace(/\/+$/g, ''))
        directories.set(providerPath, {
          name: basename(providerPath),
          path: providerPath,
          type: 'directory',
          size: 0,
          updatedAt: 0
        })
      }

      for (const object of output.Contents ?? []) {
        if (!object.Key || object.Key === prefix) continue
        const providerPath = this.stripBasePath(object.Key)
        files.set(providerPath, {
          name: basename(providerPath),
          path: providerPath,
          type: 'file',
          size: object.Size ?? 0,
          updatedAt: object.LastModified?.getTime() ?? 0,
          etag: object.ETag?.replace(/^"|"$/g, '')
        })
      }

      token = output.NextContinuationToken
    } while (token)

    return [...directories.values(), ...files.values()].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1
      if (a.type !== 'directory' && b.type === 'directory') return 1
      return a.name.localeCompare(b.name)
    })
  }

  async read(path: string): Promise<Uint8Array> {
    const output = await this.requireClient().send(
      new GetObjectCommand({
        Bucket: this.requireConfig().bucket,
        Key: this.keyFor(path)
      })
    )
    if (!output.Body) throw new Error(`S3 object has no body: ${path}`)
    return output.Body.transformToByteArray()
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.requireConfig().bucket,
        Key: this.keyFor(path),
        Body: Buffer.from(data)
      })
    )
  }

  async delete(path: string): Promise<void> {
    const key = this.keyFor(path)
    const cfg = this.requireConfig()
    const client = this.requireClient()
    if (key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
    }
    await this.deletePrefix(this.directoryPrefix(path))
  }

  async move(from: string, to: string): Promise<void> {
    const sourceKey = this.keyFor(from)
    const targetKey = this.keyFor(to)
    if (await this.objectExists(sourceKey)) {
      await this.copyObject(sourceKey, targetKey)
      await this.requireClient().send(
        new DeleteObjectCommand({ Bucket: this.requireConfig().bucket, Key: sourceKey })
      )
      return
    }

    const sourcePrefix = this.directoryPrefix(from)
    const targetPrefix = this.directoryPrefix(to)
    let token: string | undefined
    let moved = false
    do {
      const output = await this.requireClient().send(
        new ListObjectsV2Command({
          Bucket: this.requireConfig().bucket,
          Prefix: sourcePrefix,
          ContinuationToken: token
        })
      )
      for (const object of output.Contents ?? []) {
        if (!object.Key) continue
        const suffix = object.Key.slice(sourcePrefix.length)
        await this.copyObject(object.Key, `${targetPrefix}${suffix}`)
        moved = true
      }
      token = output.NextContinuationToken
    } while (token)

    if (moved) await this.deletePrefix(sourcePrefix)
  }

  async exists(path: string): Promise<boolean> {
    const key = this.keyFor(path)
    if (key && (await this.objectExists(key))) return true

    const output = await this.requireClient().send(
      new ListObjectsV2Command({
        Bucket: this.requireConfig().bucket,
        Prefix: this.directoryPrefix(path),
        MaxKeys: 1
      })
    )
    return (output.KeyCount ?? 0) > 0
  }

  private async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    await this.requireClient().send(
      new CopyObjectCommand({
        Bucket: this.requireConfig().bucket,
        Key: targetKey,
        CopySource: this.copySourceFor(sourceKey)
      })
    )
  }

  private async deletePrefix(prefix: string): Promise<void> {
    if (!prefix) return
    let token: string | undefined
    do {
      const output = await this.requireClient().send(
        new ListObjectsV2Command({
          Bucket: this.requireConfig().bucket,
          Prefix: prefix,
          ContinuationToken: token
        })
      )
      const keys = (output.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => !!key)
      if (keys.length > 0) {
        await this.requireClient().send(
          new DeleteObjectsCommand({
            Bucket: this.requireConfig().bucket,
            Delete: {
              Objects: keys.map((Key) => ({ Key })),
              Quiet: true
            }
          })
        )
      }
      token = output.NextContinuationToken
    } while (token)
  }

  private async objectExists(key: string): Promise<boolean> {
    if (!key) return false
    try {
      await this.requireClient().send(
        new HeadObjectCommand({
          Bucket: this.requireConfig().bucket,
          Key: key
        })
      )
      return true
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) {
        return false
      }
      throw err
    }
  }

  private keyFor(path: string): string {
    const cfg = this.requireConfig()
    const base = this.normalizeProviderPath(cfg.basePath)
    const providerPath = this.normalizeProviderPath(path)
    return [base, providerPath].filter(Boolean).join('/')
  }

  private directoryPrefix(path: string): string {
    const key = this.keyFor(path)
    return key ? `${key.replace(/\/+$/g, '')}/` : ''
  }

  private stripBasePath(key: string): string {
    const base = this.normalizeProviderPath(this.requireConfig().basePath)
    const cleanKey = key.replace(/^\/+|\/+$/g, '')
    if (!base) return cleanKey
    if (cleanKey === base) return ''
    return cleanKey.startsWith(`${base}/`) ? cleanKey.slice(base.length + 1) : cleanKey
  }

  private normalizeProviderPath(path: string): string {
    const clean = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!clean) return ''
    const parts = clean.split('/').filter(Boolean)
    for (const part of parts) {
      if (part === '.' || part === '..') {
        throw new Error(`Invalid S3 path: ${path}`)
      }
    }
    return posix.join(...parts)
  }

  private copySourceFor(key: string): string {
    const bucket = encodeURIComponent(this.requireConfig().bucket)
    const encodedKey = key.split('/').map((part) => encodeURIComponent(part)).join('/')
    return `${bucket}/${encodedKey}`
  }

  private requireConfig(): S3StorageConfig {
    if (!this.config) throw new Error('S3Provider is not connected')
    return this.config
  }

  private requireClient(): S3Client {
    if (!this.client) throw new Error('S3Provider is not connected')
    return this.client
  }
}
