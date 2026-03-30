import { useState, useEffect } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'

export default function ProfilePage() {
  const { user, signOut } = useStore()
  const [profile, setProfile] = useState(null)
  const [myNotes, setMyNotes] = useState([])
  const [myRooms, setMyRooms] = useState([])
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState('')

  useEffect(() => {
    if (!user?.id) return

    // Fetch profile
    supabase
      .from('nut_users')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setProfile(data)
          setUsername(data.username || '')
        }
      })

    // Fetch my notes
    supabase
      .from('nut_messages')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setMyNotes(data || []))

    // Fetch my rooms
    supabase
      .from('nut_chats')
      .select('*')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setMyRooms(data || []))
  }, [user?.id])

  const handleUpdateProfile = async () => {
    const { error } = await supabase
      .from('nut_users')
      .update({ username })
      .eq('id', user.id)
    
    if (!error) {
      setProfile({ ...profile, username })
      setEditing(false)
    }
  }

  const handleSignOut = async () => {
    if (confirm('确定要退出登录吗？')) {
      await signOut()
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="avatar-large">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            <div className="avatar-placeholder large">
              {username?.[0] || '?'}
            </div>
          )}
        </div>
        
        {editing ? (
          <div className="edit-form">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
            />
            <button onClick={handleUpdateProfile}>保存</button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        ) : (
          <div className="profile-info">
            <h2>{profile?.username || '未设置用户名'}</h2>
            <button className="edit-btn" onClick={() => setEditing(true)}>
              编辑资料
            </button>
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <span className="num">{myNotes.length}</span>
            <span className="label">留言</span>
          </div>
          <div className="stat">
            <span className="num">{myRooms.length}</span>
            <span className="label">聊天室</span>
          </div>
        </div>
      </div>

      <div className="profile-content">
        <section>
          <h3>我的留言</h3>
          {myNotes.length === 0 ? (
            <p className="empty">暂无留言</p>
          ) : (
            <div className="note-list">
              {myNotes.map(note => (
                <div key={note.id} className="note-item">
                  <p>{note.content}</p>
                  <span className="time">
                    {new Date(note.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3>我的聊天室</h3>
          {myRooms.length === 0 ? (
            <p className="empty">暂无聊天室</p>
          ) : (
            <div className="room-list">
              {myRooms.map(room => (
                <div key={room.id} className="room-item">
                  <span className="name">{room.name}</span>
                  <span className="type">{room.is_active ? '活跃' : '已关闭'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <button className="logout-btn" onClick={handleSignOut}>
        退出登录
      </button>
    </div>
  )
}
