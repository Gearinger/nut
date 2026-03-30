import { useState } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'
import { getOrCreateArea } from '../lib/areaHelper'

export default function CreateRoomModal({ onClose, onSuccess }) {
  const { user, currentLocation, setActiveRoom, setActiveTab } = useStore()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)

    // 获取或创建区域
    const location = currentLocation || { lat: 31.2304, lng: 121.4737 }
    const area = await getOrCreateArea(location.lat, location.lng)
    if (!area) {
      alert('无法获取区域信息')
      setLoading(false)
      return
    }

    const { data, error } = await supabase.from('nut_chats').insert({
      created_by: user.id,
      area_id: area.id,
      name: name.trim()
    }).select().single()

    setLoading(false)
    
    if (error) {
      alert('创建失败: ' + error.message)
    } else {
      onSuccess?.()
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
