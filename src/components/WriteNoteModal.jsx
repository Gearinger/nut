import { useState } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'
import { getOrCreateArea } from '../lib/areaHelper'

export default function WriteNoteModal({ location, onClose, onSuccess }) {
  const { user } = useStore()
  const [content, setContent] = useState('')
  const [expiry, setExpiry] = useState('24h')
  const [loading, setLoading] = useState(false)

  // 将 expiry 选项转换为实际的 expires_at 时间戳
  const getExpiresAt = (expiryOption) => {
    const now = new Date()
    switch (expiryOption) {
      case '24h':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      case '7d':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      case 'permanent':
      default:
        return null
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!content.trim() || !location) return

    setLoading(true)

    // 获取或创建区域
    const area = await getOrCreateArea(location.lat, location.lng)
    if (!area) {
      alert('无法获取区域信息')
      setLoading(false)
      return
    }

    const { error } = await supabase.from('nut_messages').insert({
      user_id: user.id,
      area_id: area.id,
      latitude: location.lat,
      longitude: location.lng,
      content: content.trim(),
      expires_at: getExpiresAt(expiry)
    })

    setLoading(false)
    if (error) {
      alert('发布失败: ' + error.message)
    } else {
      onSuccess?.()
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>📝 写留言</h3>
        
        <form onSubmit={handleSubmit}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="写下你的想法..."
            maxLength={500}
            autoFocus
          />
          
          <div className="expiry-options">
            <label>时效:</label>
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="24h">快讯 (24小时)</option>
              <option value="7d">日常 (7天)</option>
              <option value="permanent">永久</option>
            </select>
          </div>
          
          <div className="location-info">
            📍 {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : '获取中...'}
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" disabled={!content.trim() || loading}>
              {loading ? '发布中...' : '发布'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
