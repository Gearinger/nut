import { useState, useEffect } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'
import { describeDbError, checkWriteResult } from '../lib/dbError'
import { AVATAR_EMOJIS, randomAvatar, isEmojiAvatar } from '../lib/avatar'
import { getTheme, toggleTheme, THEME } from '../lib/theme'
import { setRoomActive, roomToggleConfirm } from '../lib/rooms'

export default function ProfilePage() {
  const { user, signOut } = useStore()
  const [profile, setProfile] = useState(null)
  const [myNotes, setMyNotes] = useState([])
  const [myRooms, setMyRooms] = useState([])
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')
  const [pickingAvatar, setPickingAvatar] = useState(false)
  const [roomBusyId, setRoomBusyId] = useState(null)
  // 结果提示带 ok 标记：成功是中性灰、失败才是红色，别让「已关闭」看着像报错
  const [roomMsg, setRoomMsg] = useState(null)
  // 主题是存在 <html data-theme> 上的，React 不参与渲染，
  // 所以这里存一份本地 state 只为让按钮文案跟着变
  const [theme, setTheme] = useState(getTheme)

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
    const name = (username || '').trim()
    if (!name) {
      setProfileMsg('用户名不能为空')
      return
    }

    setSaving(true)
    setProfileMsg('')
    try {
      // 用 upsert 而不是 update，原因有两个：
      // 1) 新注册用户可能还没有 nut_users 档案，update 会命中 0 行，永远存不进去；
      // 2) PostgREST 的 update 命中 0 行时依然返回 204、error 为 null，
      //    只看 error 会把「没写进去」误判成「保存成功」。
      // upsert + select 拿回实际写入的行，才能真正确认结果。
      const { data, error } = await supabase
        .from('nut_users')
        .upsert({ id: user.id, username: name }, { onConflict: 'id' })
        .select()
        .single()

      if (error) {
        setProfileMsg('保存失败：' + describeDbError(error))
        return
      }
      if (!data) {
        setProfileMsg('保存失败：没有写入任何记录，请检查账号权限')
        return
      }

      setProfile(data)
      setUsername(data.username || name)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  // 选 emoji 头像：立刻落库，失败要看得见（否则点了没反应还以为选上了）
  const handlePickAvatar = async (emoji) => {
    if (!user?.id || saving) return
    setSaving(true)
    setProfileMsg('')
    try {
      const result = await supabase
        .from('nut_users')
        .update({ avatar_url: emoji })
        .eq('id', user.id)
        .select()
        .single()

      const failure = checkWriteResult(result, '头像保存')
      if (failure) {
        setProfileMsg(failure)
        return
      }
      setProfile(result.data)
      setPickingAvatar(false)
    } finally {
      setSaving(false)
    }
  }

  // 关闭 / 重新打开聊天室（软删：只改 is_active，消息一条不动）
  // 这里查的是 created_by = 自己的房间，所以一定是创建者，不用再判一次
  const handleToggleRoom = async (room) => {
    if (!user?.id || roomBusyId) return

    const nextActive = !room.is_active
    if (!confirm(roomToggleConfirm(room.name, nextActive))) return

    setRoomBusyId(room.id)
    setRoomMsg(null)
    try {
      const { failure } = await setRoomActive(supabase, room.id, nextActive)
      if (failure) {
        setRoomMsg({ ok: false, text: failure })
        return
      }
      setMyRooms(prev =>
        prev.map(r => (r.id === room.id ? { ...r, is_active: nextActive } : r))
      )
      setRoomMsg({
        ok: true,
        text: nextActive ? '已重新打开' : '已关闭，聊天记录保留',
      })
    } finally {
      setRoomBusyId(null)
    }
  }

  const handleToggleTheme = () => {
    setTheme(toggleTheme())
  }

  const handleSignOut = async () => {
    if (confirm('确定要退出登录吗？')) {
      await signOut()
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <button
          type="button"
          className="avatar-large"
          onClick={() => setPickingAvatar(v => !v)}
          aria-label="选择头像"
          title="点击换个头像"
        >
          {isEmojiAvatar(profile?.avatar_url) ? (
            <span className="avatar-emoji">{profile.avatar_url}</span>
          ) : profile?.avatar_url ? (
            // 非 emoji 的旧值按图片处理（这一列原本是给头像 URL 留的）
            <img src={profile.avatar_url} alt="" />
          ) : (
            <span className="avatar-emoji placeholder">{username?.[0] || '?'}</span>
          )}
        </button>

        {pickingAvatar && (
          <div className="avatar-picker">
            <p className="picker-tip">选一个当你的头像</p>
            <div className="avatar-grid">
              {AVATAR_EMOJIS.map(emoji => (
                <button
                  type="button"
                  key={emoji}
                  className={`avatar-option${profile?.avatar_url === emoji ? ' selected' : ''}`}
                  onClick={() => handlePickAvatar(emoji)}
                  disabled={saving}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="picker-random"
              onClick={() => handlePickAvatar(randomAvatar())}
              disabled={saving}
            >
              🎲 随机一个
            </button>
            {/* 选头像时 editing 是 false，编辑态那处 profileMsg 不会渲染，
                这里必须单独显示，否则保存失败点了没反应还以为选上了 */}
            {profileMsg && <p className="profile-msg">{profileMsg}</p>}
          </div>
        )}
        
        {editing ? (
          <div className="edit-form">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              disabled={saving}
            />
            <button onClick={handleUpdateProfile} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              onClick={() => {
                // 取消要把输入还原，否则下次点编辑会看到上次的脏值
                setEditing(false)
                setUsername(profile?.username || '')
                setProfileMsg('')
              }}
            >
              取消
            </button>
            {profileMsg && <p className="profile-msg">{profileMsg}</p>}
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
                  <div className="room-actions">
                    <span className={`type ${room.is_active ? 'active' : 'inactive'}`}>
                      {room.is_active ? '活跃' : '已关闭'}
                    </span>
                    <button
                      type="button"
                      className="room-toggle-btn"
                      onClick={() => handleToggleRoom(room)}
                      disabled={roomBusyId === room.id}
                      title={room.is_active ? '关闭这个聊天室' : '重新打开这个聊天室'}
                    >
                      {roomBusyId === room.id
                        ? '处理中…'
                        : room.is_active ? '关闭' : '重新打开'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {roomMsg && (
            <p className={`room-msg${roomMsg.ok ? '' : ' error'}`}>{roomMsg.text}</p>
          )}
        </section>
      </div>

      <button className="theme-toggle" onClick={handleToggleTheme}>
        <span className="theme-icon" aria-hidden="true">
          {theme === THEME.DARK ? '🌙' : '☀️'}
        </span>
        {theme === THEME.DARK ? '深色模式' : '浅色模式'}
        <span className="theme-switch" aria-hidden="true" />
      </button>

      <button className="logout-btn" onClick={handleSignOut}>
        退出登录
      </button>
    </div>
  )
}
