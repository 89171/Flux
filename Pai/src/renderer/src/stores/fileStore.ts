import { create } from 'zustand'
import type { NoteFile } from '@shared/types'

interface FileState {
  /** File tree as an array of top-level entries (root level). */
  tree: NoteFile[]
  currentFile: NoteFile | null
  currentContent: string
  isLoading: boolean
  isDirty: boolean
  workspacePath: string
  loadTree: () => Promise<void>
  openFile: (file: NoteFile) => Promise<void>
  setContent: (content: string) => void
  saveFile: () => Promise<void>
  createFile: (parentPath: string, name: string, isDir: boolean) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  moveFile: (sourcePath: string, targetDir: string) => Promise<void>
  openFolder: () => Promise<void>
}

export const useFileStore = create<FileState>((set, get) => ({
  tree: [],
  currentFile: null,
  currentContent: '',
  isLoading: false,
  isDirty: false,
  workspacePath: '',

  loadTree: async () => {
    set({ isLoading: true })
    try {
      const tree = await window.painote.file.getTree()
      // The IPC handler returns NoteFile[] — normalize to array
      const treeArray = Array.isArray(tree) ? tree : (tree as NoteFile).children || []
      set({ tree: treeArray, isLoading: false })
    } catch (err) {
      console.error('Failed to load file tree:', err)
      set({ tree: [], isLoading: false })
    }
  },

  openFile: async (file) => {
    if (file.type === 'directory') return
    try {
      const content = await window.painote.file.read(file.path)
      set({ currentFile: file, currentContent: content, isDirty: false })
    } catch (err) {
      console.error('Failed to open file:', err)
      set({ currentFile: file, currentContent: '', isDirty: false })
    }
  },

  setContent: (content) => set({ currentContent: content, isDirty: true }),

  saveFile: async () => {
    const { currentFile, currentContent } = get()
    if (!currentFile) return
    try {
      await window.painote.file.write(currentFile.path, currentContent)
      set({ isDirty: false })
    } catch (err) {
      console.error('Failed to save file:', err)
    }
  },

  createFile: async (parentPath, name, isDir) => {
    const path = parentPath ? `${parentPath}/${name}` : name
    try {
      await window.painote.file.create(path, '', isDir)
      await get().loadTree()
    } catch (err) {
      console.error('Failed to create file:', err)
      throw err
    }
  },

  deleteFile: async (path) => {
    try {
      await window.painote.file.delete(path)
      const { currentFile } = get()
      if (currentFile?.path === path) {
        set({ currentFile: null, currentContent: '' })
      }
      await get().loadTree()
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
      await window.painote.file.rename(oldPath, newPath)
      await get().loadTree()
    } catch (err) {
      console.error('Failed to rename file:', err)
      throw err
    }
  },

  moveFile: async (sourcePath, targetDir) => {
    try {
      await window.painote.file.move(sourcePath, targetDir)
      await get().loadTree()
    } catch (err) {
      console.error('Failed to move file:', err)
      throw err
    }
  },

  openFolder: async () => {
    try {
      const result = await window.painote.dialog.openDirectory({ title: 'Open Folder' })
      if (!result) return
      // result is a string path from the IPC handler
      const folderPath = Array.isArray(result) ? result[0] : result
      if (!folderPath) return
      await window.painote.settings.set({ workspacePath: folderPath })
      set({ workspacePath: folderPath, currentFile: null, currentContent: '' })
      await get().loadTree()
    } catch (err) {
      console.error('Failed to open folder:', err)
    }
  }
}))
