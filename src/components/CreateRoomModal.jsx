import { useState } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'

export default function CreateRoomModal({ location, onClose }) {
  const { user, setActiveRoom, setActiveTab } = useStore()
  const [name, setName] = useState('')
  const [type, setType] = useState('temp')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !location) return

    setLoading(true)
    
    const expiresAt = type === 'temp' 
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      : null

    const { data, error } = await supabase.from('rooms').insert({
      user_id: user.id,
      lat: location.lat,
      lng: location.lng,
      name: name.trim(),
      type,
      expires_at: expiresAt
    }).select().single()

    setLoading(false)
    
    if (error) {
      alert('创建失败: ' + error.message)
    } else {
      setActiveRoom(data)
      setActiveTab('chat')
      onClose()
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>💬 创建聊天室</h3>
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="聊天室名称"
            maxLength={30}
            autoFocus
          />
          
          <div className="type-options">
            <label>类型:</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="temp">⏰ 临时 (24小时后解散)</option>
              <option value="permanent">📌 永久</option>
            </select>
          </div>
          
          <div className="location-info">
            📍 {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : '获取中...'}
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button type="submit" disabled={!name.trim() || loading}>
              {loading ? '创建中...' : '创建并加入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
