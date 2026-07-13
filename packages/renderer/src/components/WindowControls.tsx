import { useWindowStore } from '../store/window'

/**
 * 顶部导航栏的窗口置顶控件。
 * - Pin/Unpin 按钮（一键置顶）
 * - 点击齿轮展开设置面板：透明度滑块、贴边收起开关、开机自启开关
 */
export function WindowControls(): JSX.Element {
  const { pinned, opacity, autoHide, autoStart, panelOpen, togglePin, setOpacity, toggleAutoHide, toggleAutoStart, setPanelOpen } =
    useWindowStore()

  return (
    <div className="win-controls">
      <button
        className={`pin-btn ${pinned ? 'active' : ''}`}
        onClick={() => void togglePin()}
        title={pinned ? '取消置顶' : '置顶到桌面最顶层'}
      >
        {pinned ? '置顶中' : 'Pin'}
      </button>
      <button
        className={`settings-btn ${panelOpen ? 'active' : ''}`}
        onClick={() => setPanelOpen(!panelOpen)}
        title="窗口设置"
        disabled={!pinned}
      >
        设置
      </button>
      {panelOpen && pinned && (
        <div className="win-settings-panel">
          <div className="setting-row">
            <label>透明度</label>
            <div className="opacity-control">
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => void setOpacity(parseFloat(e.target.value))}
              />
              <span className="opacity-value">{Math.round(opacity * 100)}%</span>
            </div>
          </div>
          <div className="setting-row">
            <label>贴边收起</label>
            <button
              className={`toggle ${autoHide ? 'on' : ''}`}
              onClick={() => void toggleAutoHide()}
            >
              {autoHide ? '开' : '关'}
            </button>
          </div>
          <div className="setting-row">
            <label>开机自启</label>
            <button
              className={`toggle ${autoStart ? 'on' : ''}`}
              onClick={() => void toggleAutoStart()}
            >
              {autoStart ? '开' : '关'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
