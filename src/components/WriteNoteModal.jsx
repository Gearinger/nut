import { useState } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'

export default function WriteNoteModal({ location, onClose }) {
  const { user } = useStore()
  const [content, setContent] = useState('')
  const [expiry, setExpiry] = useState('24h')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!content.trim() || !location) return

    setLoading(true)
    const { error } = await supabase.from('notes').insert({
      user_id: user.id,
      lat: location.lat,
      lng: location.lng,
      content: content.trim(),
      expiry
    })

    setLoading(false)
    if (error) {
      alert('发布失败: ' + error.message)
    } else {
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
