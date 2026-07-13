import { useEffect, useState } from 'react'
import { useWindowStore } from '../store/window'

/**
 * 右下角悬浮的快速置顶控件。
 * 鼠标移动到右下角区域时浮现，移开后自动隐藏。
 * 提供一键 Pin/Unpin，无需点击顶部导航栏。
 */
export function FloatingPinControl(): JSX.Element {
  const { pinned, togglePin } = useWindowStore()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const HOT_ZONE = 120 // 右下角热区大小（px）

    const handleMouseMove = (e: MouseEvent): void => {
      const nearRight = e.clientX >= window.innerWidth - HOT_ZONE
      const nearBottom = e.clientY >= window.innerHeight - HOT_ZONE
      setVisible(nearRight && nearBottom)
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // 置顶后始终显示
  if (!visible && !pinned) return <></>

  return (
    <div className={`floating-pin ${visible ? 'show' : ''} ${pinned ? 'pinned' : ''}`}>
      <button onClick={() => void togglePin()} title={pinned ? '取消置顶' : '置顶到桌面'}>
        {pinned ? '取消置顶' : 'Pin 到桌面'}
      </button>
    </div>
  )
}
