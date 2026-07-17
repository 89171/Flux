export interface SaveTextExportOptions {
  title: string
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
  data: string
}

export interface SaveBlobExportOptions {
  title: string
  defaultPath: string
  filters: Array<{ name: string; extensions: string[] }>
  blob: Blob
}

export function getExportBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || 'document'
}

export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || 'txt'
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function saveTextExport(options: SaveTextExportOptions): Promise<string | null> {
  return window.flux.file.exportData({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters,
    data: options.data,
    encoding: 'utf8'
  })
}

export async function saveBlobExport(options: SaveBlobExportOptions): Promise<string | null> {
  return window.flux.file.exportData({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters,
    data: await blobToBase64(options.blob),
    encoding: 'base64'
  })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function buildStandaloneHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  body {
    margin: 0;
    padding: 32px;
    background: #f8fafc;
    color: #17202a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.6;
  }
  main {
    max-width: 960px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 28px;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
  }
  svg, img { max-width: 100%; height: auto; }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.7;
  }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`
}

function parseSvgDimension(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.endsWith('%')) return null
  const parsed = Number.parseFloat(trimmed.replace(/px$/i, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function normalizeSvgForExport(svg: string): { svg: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('Invalid SVG')

  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('SVG root not found')
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part))

  const width = parseSvgDimension(root.getAttribute('width')) ?? viewBox?.[2] ?? 800
  const height = parseSvgDimension(root.getAttribute('height')) ?? viewBox?.[3] ?? 600

  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${width} ${height}`)

  return {
    svg: new XMLSerializer().serializeToString(root),
    width,
    height
  }
}

export async function svgToPngBlob(
  svg: string,
  scale = 2,
  background = '#ffffff'
): Promise<Blob> {
  const normalized = normalizeSvgForExport(svg)
  const svgBlob = new Blob([normalized.svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)

  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(normalized.width * scale))
    canvas.height = Math.max(1, Math.ceil(normalized.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('PNG export failed'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load SVG image'))
    image.src = src
  })
}
