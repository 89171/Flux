import { app, BrowserWindow, screen } from 'electron'
import type { WindowState } from '@shared'

/**
 * PinManager — 管理窗口置顶的完整生命周期。
 *
 * 功能：
 *  1. always-on-top 置顶，层级 screen-saver（高于普通窗口）
 *  2. macOS 跨虚拟空间（Space）置顶：setVisibleOnAllWorkspaces + 全屏可见
 *  3. 自定义透明度：setOpacity
 *  4. 贴边自动收起：窗口靠近屏幕边缘时失焦自动折叠为细条，聚焦/悬停恢复
 *  5. 开机自启：app.setLoginItemSettings
 *
 * 每个窗口维护独立的 WindowState，支持多窗口同时置顶。
 */

/** 贴边判定阈值（px） */
const EDGE_THRESHOLD = 20
/** 收起后窗口高度（px） */
const COLLAPSED_HEIGHT = 6
/** 收起后窗口宽度（px），仅左右贴边时使用 */
const COLLAPSED_WIDTH = 6

interface InternalState extends WindowState {
  /** 收起前保存的原始边界，用于恢复 */
  savedBounds?: { x: number; y: number; width: number; height: number }
  /** move 事件防抖计时器 */
  moveTimer?: ReturnType<typeof setTimeout>
  /** 当前是否已注册事件监听 */
  listening: boolean
}

class PinManager {
  private states = new Map<number, InternalState>()

  private ensure(win: BrowserWindow): InternalState {
    const id = win.id
    let st = this.states.get(id)
    if (!st) {
      st = {
        pinned: false,
        opacity: 1,
        autoStart: false,
        autoHide: false,
        collapsed: false,
        listening: false
      }
      this.states.set(id, st)
    }
    return st
  }

  /**
   * 置顶窗口。
   * - setAlwaysOnTop(true, 'screen-saver') 确保高于所有普通窗口
   * - setVisibleOnAllWorkspaces 让窗口在 macOS 所有 Space 中可见
   * - setFullScreenable(false) 防止全屏时隐藏
   */
  pin(win: BrowserWindow): WindowState {
    const st = this.ensure(win)
    st.pinned = true
    win.setAlwaysOnTop(true, 'screen-saver')
    // macOS 跨 Space 置顶
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setFullScreenable(false)
    this.setupAutoHide(win)
    return this.publicState(st)
  }

  /** 取消置顶，恢复窗口默认行为 */
  unpin(win: BrowserWindow): WindowState {
    const st = this.ensure(win)
    st.pinned = false
    win.setAlwaysOnTop(false)
    win.setVisibleOnAllWorkspaces(false)
    win.setFullScreenable(true)
    // 取消置顶时也关闭贴边收起
    this.teardownAutoHide(win)
    st.autoHide = false
    st.collapsed = false
    return this.publicState(st)
  }

  /** 设置窗口透明度（0.1 ~ 1.0） */
  setOpacity(win: BrowserWindow, opacity: number): WindowState {
    const st = this.ensure(win)
    const clamped = Math.max(0.1, Math.min(1, opacity))
    st.opacity = clamped
    win.setOpacity(clamped)
    return this.publicState(st)
  }

  /**
   * 开机自启。
   * macOS 使用 app.setLoginItemSettings；
   * Windows/Linux 同样支持 setLoginItemSettings。
   */
  setAutoStart(enabled: boolean): WindowState {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // macOS 隐藏窗口启动
      openAsHidden: process.platform === 'darwin'
    })
    // autoStart 是全局设置，不绑定特定窗口
    // 但为保持 API 一致性，返回第一个已知窗口的状态（或默认）
    const firstWin = BrowserWindow.getAllWindows()[0]
    if (firstWin) {
      const st = this.ensure(firstWin)
      st.autoStart = enabled
      return this.publicState(st)
    }
    return { pinned: false, opacity: 1, autoStart: enabled, autoHide: false, collapsed: false }
  }

  /** 开启/关闭贴边自动收起 */
  setAutoHide(win: BrowserWindow, enabled: boolean): WindowState {
    const st = this.ensure(win)
    st.autoHide = enabled
    if (enabled) {
      this.setupAutoHide(win)
    } else {
      this.teardownAutoHide(win)
      // 恢复窗口
      if (st.collapsed && st.savedBounds) {
        win.setBounds(st.savedBounds)
        st.collapsed = false
        st.savedBounds = undefined
      }
    }
    return this.publicState(st)
  }

  /** 获取窗口当前状态 */
  getState(win: BrowserWindow): WindowState {
    const st = this.ensure(win)
    // 读取当前开机自启设置
    st.autoStart = app.getLoginItemSettings().openAtLogin
    return this.publicState(st)
  }

  /** 窗口关闭时清理状态 */
  cleanup(win: BrowserWindow): void {
    const id = win.id
    const st = this.states.get(id)
    if (st?.moveTimer) clearTimeout(st.moveTimer)
    this.states.delete(id)
  }

  // ---------- 内部方法 ----------

  /**
   * 注册贴边收起的事件监听。
   * - move：检测窗口是否靠近屏幕边缘（防抖 300ms）
   * - blur：失焦时若已贴边则收起
   * - focus：聚焦时恢复
   */
  private setupAutoHide(win: BrowserWindow): void {
    const st = this.ensure(win)
    if (st.listening) return
    st.listening = true

    const onMove = (): void => {
      if (!st.autoHide || !st.pinned) return
      if (st.moveTimer) clearTimeout(st.moveTimer)
      st.moveTimer = setTimeout(() => {
        this.checkEdge(win)
      }, 300)
    }

    const onBlur = (): void => {
      if (!st.autoHide || !st.pinned) return
      const docked = this.isDocked(win)
      if (docked && !st.collapsed) {
        this.collapse(win)
      }
    }

    const onFocus = (): void => {
      if (!st.autoHide || !st.pinned) return
      if (st.collapsed) {
        this.expand(win)
      }
    }

    win.on('move', onMove)
    win.on('blur', onBlur)
    win.on('focus', onFocus)

    // 保存引用以便后续移除
    ;(win as unknown as { _pinListeners?: unknown })._pinListeners = { onMove, onBlur, onFocus }
  }

  /** 移除事件监听 */
  private teardownAutoHide(win: BrowserWindow): void {
    const ref = (win as unknown as { _pinListeners?: Record<string, () => void> })._pinListeners
    if (ref) {
      win.removeListener('move', ref.onMove)
      win.removeListener('blur', ref.onBlur)
      win.removeListener('focus', ref.onFocus)
      ;(win as unknown as { _pinListeners?: unknown })._pinListeners = undefined
    }
    const st = this.ensure(win)
    st.listening = false
  }

  /** 检查窗口是否靠近屏幕边缘 */
  private isDocked(win: BrowserWindow): boolean {
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    return (
      bounds.x <= workArea.x + EDGE_THRESHOLD ||
      bounds.x + bounds.width >= workArea.x + workArea.width - EDGE_THRESHOLD ||
      bounds.y <= workArea.y + EDGE_THRESHOLD ||
      bounds.y + bounds.height >= workArea.y + workArea.height - EDGE_THRESHOLD
    )
  }

  /** move 事件后检查边缘，如已贴边则立即收起 */
  private checkEdge(win: BrowserWindow): void {
    const st = this.ensure(win)
    if (!this.isDocked(win)) return
    // 贴边且窗口未聚焦时收起
    if (!win.isFocused() && !st.collapsed) {
      this.collapse(win)
    }
  }

  /** 收起窗口为细条 */
  private collapse(win: BrowserWindow): void {
    const st = this.ensure(win)
    if (st.collapsed) return
    st.savedBounds = win.getBounds()
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea

    // 根据贴边方向决定收起形态
    const dockedLeft = bounds.x <= workArea.x + EDGE_THRESHOLD
    const dockedRight = bounds.x + bounds.width >= workArea.x + workArea.width - EDGE_THRESHOLD
    const dockedTop = bounds.y <= workArea.y + EDGE_THRESHOLD

    if (dockedLeft) {
      win.setBounds({
        x: workArea.x,
        y: bounds.y,
        width: COLLAPSED_WIDTH,
        height: bounds.height
      })
    } else if (dockedRight) {
      win.setBounds({
        x: workArea.x + workArea.width - COLLAPSED_WIDTH,
        y: bounds.y,
        width: COLLAPSED_WIDTH,
        height: bounds.height
      })
    } else if (dockedTop) {
      win.setBounds({
        x: bounds.x,
        y: workArea.y,
        width: bounds.width,
        height: COLLAPSED_HEIGHT
      })
    }
    st.collapsed = true
  }

  /** 恢复窗口到收起前的大小 */
  private expand(win: BrowserWindow): void {
    const st = this.ensure(win)
    if (!st.collapsed || !st.savedBounds) return
    win.setBounds(st.savedBounds)
    st.collapsed = false
    st.savedBounds = undefined
  }

  /** 将内部状态转为对外返回的 WindowState */
  private publicState(st: InternalState): WindowState {
    return {
      pinned: st.pinned,
      opacity: st.opacity,
      autoStart: st.autoStart,
      autoHide: st.autoHide,
      collapsed: st.collapsed
    }
  }
}

// 单例
let _instance: PinManager | null = null

export function getPinManager(): PinManager {
  if (!_instance) _instance = new PinManager()
  return _instance
}
