import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs'
import type { Note } from '@shared/types'

function getNotesDir(): string {
  const dir = join(app.getPath('userData'), 'notes-data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function getMetaPath(): string {
  return join(getNotesDir(), 'notes.json')
}

function readMeta(): Note[] {
  const p = getMetaPath()
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Note[]
  } catch {
    return []
  }
}

function writeMeta(notes: Note[]): void {
  writeFileSync(getMetaPath(), JSON.stringify(notes, null, 2), 'utf-8')
}

function contentPath(noteId: string): string {
  return join(getNotesDir(), `${noteId}.json`)
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function listNotes(): Note[] {
  return readMeta().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createNote(format: string, title?: string): { note: Note; raw: string } {
  const now = Date.now()
  const note: Note = {
    id: genId(),
    title: title?.trim() || '未命名笔记',
    format,
    createdAt: now,
    updatedAt: now
  }
  const notes = readMeta()
  notes.push(note)
  writeMeta(notes)
  // 空内容文件
  writeFileSync(contentPath(note.id), '', 'utf-8')
  return { note, raw: '' }
}

export function getNote(id: string): { note: Note; raw: string } | null {
  const note = readMeta().find((n) => n.id === id)
  if (!note) return null
  let raw = ''
  if (existsSync(contentPath(id))) {
    raw = readFileSync(contentPath(id), 'utf-8')
  }
  return { note, raw }
}

export function saveNote(id: string, raw: string, title?: string): Note | null {
  const notes = readMeta()
  const idx = notes.findIndex((n) => n.id === id)
  if (idx < 0) return null
  if (title !== undefined) notes[idx].title = title.trim() || notes[idx].title
  notes[idx].updatedAt = Date.now()
  writeMeta(notes)
  writeFileSync(contentPath(id), raw, 'utf-8')
  return notes[idx]
}

export function deleteNote(id: string): void {
  const notes = readMeta().filter((n) => n.id !== id)
  writeMeta(notes)
  if (existsSync(contentPath(id))) unlinkSync(contentPath(id))
}

// 清理孤儿内容文件（可选维护）
export function pruneOrphanContent(): void {
  const ids = new Set(readMeta().map((n) => n.id))
  for (const f of readdirSync(getNotesDir())) {
    if (!f.endsWith('.json') || f === 'notes.json') continue
    const id = f.replace(/\.json$/, '')
    if (!ids.has(id)) unlinkSync(join(getNotesDir(), f))
  }
}
