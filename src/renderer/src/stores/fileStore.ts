import { create } from 'zustand'
import type { NoteFile } from '@shared/types'

interface FileState {
  /** File tree as an array of top-level entries (root level). */
  tree: NoteFile[]
  currentFile: NoteFile | null
  currentContent: string
  /** mtime observed when `currentFile` was loaded, in ms since epoch. */
  currentMtime: number | null
  isLoading: boolean
  isDirty: boolean
  /** True when a save was refused because the file changed underneath us. */
  hasConflict: boolean
  /** Non-null when a file read or save operation failed visibly. */
  fileError: string | null
  workspacePath: string
  loadTree: () => Promise<void>
  applyTreeUpdate: (tree: NoteFile[]) => void
  openFile: (file: NoteFile) => Promise<void>
  setContent: (content: string) => void
  saveFile: () => Promise<void>
  reloadCurrent: () => Promise<void>
  clearError: () => void
  applyExternalChange: (path: string, content: string, mtime: number) => void
  createFile: (parentPath: string, name: string, isDir: boolean) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  moveFile: (sourcePath: string, targetDir: string) => Promise<void>
  openFolder: () => Promise<void>
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

export const useFileStore = create<FileState>((set, get) => ({
  tree: [],
  currentFile: null,
  currentContent: '',
  currentMtime: null,
  isLoading: false,
  isDirty: false,
  hasConflict: false,
  fileError: null,
  workspacePath: '',

  loadTree: async () => {
    set({ isLoading: true })
    try {
      const tree = await window.flux.file.getTree()
      set({ tree, isLoading: false })
    } catch (err) {
      console.error('Failed to load file tree:', err)
      set({ tree: [], isLoading: false })
    }
  },

  /**
   * Apply a push update from main. Fired by the FILE_TREE_CHANGED_EVENT
   * broadcast — no IPC round-trip, no re-walk of the workspace. Also
   * handles external changes (user edits files via Finder / another editor).
   */
  applyTreeUpdate: (tree) => set({ tree }),

  openFile: async (file) => {
    if (file.type === 'directory') return
    const state = get()
    // Flush unsaved edits before switching. Uses the guarded write so a
    // conflict aborts the switch instead of clobbering another window's edits.
    if (state.isDirty && state.currentFile) {
      try {
        const result = await window.flux.file.writeGuarded(
          state.currentFile.path,
          state.currentContent,
          state.currentMtime
        )
        if (!result.ok) {
          console.warn('Autosave hit a conflict; aborting file switch to protect data.')
          set({ hasConflict: true })
          return
        }
      } catch (err) {
        console.error('Autosave before switching file failed; aborting switch:', err)
        return
      }
    }
    try {
      const { content, mtime } = await window.flux.file.readMeta(file.path)
      set({
        currentFile: file,
        currentContent: content,
        currentMtime: mtime,
        isDirty: false,
        hasConflict: false,
        fileError: null
      })
    } catch (err) {
      console.error('Failed to open file:', err)
      set({
        currentFile: file,
        currentContent: '',
        currentMtime: null,
        isDirty: false,
        hasConflict: false,
        fileError: `Failed to read "${file.name}": ${err instanceof Error ? err.message : String(err)}`
      })
    }
  },

  setContent: (content) => {
    set({ currentContent: content, isDirty: true })
    // Debounced autosave — 2 s after the last keystroke.
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(async () => {
      autosaveTimer = null
      const { currentFile, currentContent: latest, currentMtime, hasConflict } = get()
      if (!currentFile || hasConflict) return
      try {
        const result = await window.flux.file.writeGuarded(currentFile.path, latest, currentMtime)
        if (result.ok) {
          set({ isDirty: false, currentMtime: result.mtime, hasConflict: false })
        } else {
          set({ hasConflict: true })
        }
      } catch {
        // Silent — user can still save manually with Cmd+S
      }
    }, 2000)
  },

  saveFile: async () => {
    const { currentFile, currentContent, currentMtime } = get()
    if (!currentFile) return
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    try {
      const result = await window.flux.file.writeGuarded(
        currentFile.path,
        currentContent,
        currentMtime
      )
      if (result.ok) {
        set({ isDirty: false, currentMtime: result.mtime, hasConflict: false, fileError: null })
      } else {
        console.warn(
          `Save refused: file changed externally (disk mtime ${result.diskMtime}). Local edits retained.`
        )
        set({ hasConflict: true })
      }
    } catch (err) {
      console.error('Failed to save file:', err)
      set({ fileError: `Failed to save "${currentFile.name}": ${err instanceof Error ? err.message : String(err)}` })
    }
  },

  reloadCurrent: async () => {
    const { currentFile } = get()
    if (!currentFile) return
    try {
      const { content, mtime } = await window.flux.file.readMeta(currentFile.path)
      set({
        currentContent: content,
        currentMtime: mtime,
        isDirty: false,
        hasConflict: false,
        fileError: null
      })
    } catch (err) {
      console.error('Failed to reload current file:', err)
      set({ fileError: `Failed to reload "${currentFile.name}": ${err instanceof Error ? err.message : String(err)}` })
    }
  },

  clearError: () => set({ fileError: null }),

  /**
   * Fold an external write (from another window / autosave broadcast) into
   * the current buffer. If the user has unsaved edits, we surface a conflict
   * flag instead of overwriting — they can decide whether to reload.
   */
  applyExternalChange: (path, content, mtime) => {
    const { currentFile, isDirty } = get()
    if (!currentFile || currentFile.path !== path) return
    if (isDirty) {
      set({ hasConflict: true })
      return
    }
    set({ currentContent: content, currentMtime: mtime, hasConflict: false })
  },

  // Mutations no longer trigger loadTree() — the main-side chokidar watcher
  // pushes an updated tree via FILE_TREE_CHANGED_EVENT once the write settles.
  createFile: async (parentPath, name, isDir) => {
    const path = parentPath ? `${parentPath}/${name}` : name
    try {
      await window.flux.file.create(path, '', isDir)
    } catch (err) {
      console.error('Failed to create file:', err)
      throw err
    }
  },

  deleteFile: async (path) => {
    try {
      await window.flux.file.delete(path)
      const { currentFile } = get()
      if (currentFile?.path === path) {
        set({ currentFile: null, currentContent: '', currentMtime: null })
      }
    } catch (err) {
      console.error('Failed to delete file:', err)
      throw err
    }
  },

  renameFile: async (oldPath, newName) => {
    const parts = oldPath.split('/')
    parts[parts.length - 1] = newName
    const newPath = parts.join('/')
    try {
      await window.flux.file.rename(oldPath, newPath)
    } catch (err) {
      console.error('Failed to rename file:', err)
      throw err
    }
  },

  moveFile: async (sourcePath, targetDir) => {
    try {
      await window.flux.file.move(sourcePath, targetDir)
    } catch (err) {
      console.error('Failed to move file:', err)
      throw err
    }
  },

  openFolder: async () => {
    try {
      const result = await window.flux.dialog.openDirectory({ title: 'Open Folder' })
      if (!result) return
      const folderPath = Array.isArray(result) ? result[0] : result
      if (!folderPath) return
      await window.flux.settings.set({ workspacePath: folderPath })
      set({
        workspacePath: folderPath,
        currentFile: null,
        currentContent: '',
        currentMtime: null
      })
      await get().loadTree()
    } catch (err) {
      console.error('Failed to open folder:', err)
    }
  }
}))
