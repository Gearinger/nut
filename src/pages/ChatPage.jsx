import { useState, useEffect, useRef } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'
import { canInteractInFence, fenceSummary } from '../lib/fence'
import { runWriteWithProfileHeal } from '../lib/flowerAuth'
import { isEmojiAvatar } from '../lib/avatar'
import { setRoomActive, roomToggleConfirm } from '../lib/rooms'

export default function ChatPage() {
  const {
    activeRoom, messages, fetchMessages, markMessagesAsRead,
    user, myRooms, fetchMyRooms, setActiveRoom, fetchRooms,
    currentLocation, setCurrentLocation,
  } = useStore()
  const [input, setInput] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const [closingRoom, setClosingRoom] = useState(false)
  const messagesEndRef = useRef()
  const listRef = useRef(null)

  const roomId = activeRoom?.id
  const roomMessages = roomId ? (messages[roomId] || []) : []
  // 围栏判定提前到这里，handleSend 与 JSX 都直接用它，避免声明顺序上的隐患
  const insideFence = canInteractInFence(
    currentLocation?.lat,
    currentLocation?.lng,
    activeRoom
  )

  // 在房间里时持续监听位置：走出围栏要立刻转为只读，走回来要能恢复
  useEffect(() => {
    if (!activeRoom || !navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => { /* 定位失败时沿用上一次的已知位置 */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [activeRoom?.id])

  // 获取用户参与的聊天室
  useEffect(() => {
    if (user) {
      fetchMyRooms(user.id)
    }
  }, [user])

  useEffect(() => {
    if (!roomId) return

    fetchMessages(roomId)

    // Realtime 正常时不再轮询，只有连不上时才降级，避免每 3 秒打一次库
    let pollInterval = null
    const stopPolling = () => {
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    }
    const startPolling = () => {
      if (pollInterval) return
      pollInterval = setInterval(() => {
        // 页面在后台时不请求，回到前台后由 visibilitychange 补一次
        if (document.visibilityState === 'visible') fetchMessages(roomId)
      }, 5000)
    }
    startPolling()

    const channel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'nut_chat_messages',
        filter: `chat_id=eq.${roomId}`
      }, () => {
        // 收到新消息或更新时重新获取整个消息列表
        fetchMessages(roomId)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') stopPolling()
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') startPolling()
      })

    return () => {
      supabase.removeChannel(channel)
      stopPolling()
    }
  }, [roomId])

  // 消息到达或用户回到前台时标记已读
  useEffect(() => {
    if (roomId && user && roomMessages.length > 0) {
      markMessagesAsRead(roomId, user.id)
    }
  }, [roomId, roomMessages.length])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && roomId) fetchMessages(roomId)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [roomId])

  // 只有本来就贴在底部时才自动跟随，用户翻历史消息时不再被强行拉回底部
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80
    if (nearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [roomMessages.length])

  const handleBack = () => {
    setActiveRoom(null)
  }

  // 只有创建者能关：按钮同样只在 created_by === 自己时渲染，
  // 这里再判一次，防止将来别处直接调这个函数。
  const isOwner = !!user?.id && !!activeRoom?.created_by && activeRoom.created_by === user.id

  const handleCloseRoom = async () => {
    if (!isOwner || closingRoom) return
    if (!confirm(roomToggleConfirm(activeRoom.name, false))) return

    setClosingRoom(true)
    try {
      const { failure } = await setRoomActive(supabase, activeRoom.id, false)
      if (failure) {
        setSendError(failure)
        return
      }
      // 关掉后房间不再出现在列表里，退回列表页并刷新一次
      setActiveRoom(null)
      fetchRooms()
    } finally {
      setClosingRoom(false)
    }
  }

  const handleSend = async (e) => {
    e.preventDefault()
    // 服务端有围栏触发器兜底，这里只是提前给用户明确反馈
    if (!user || !input.trim() || !activeRoom || !insideFence) return
    // 防重复提交：连点发送 / 连按回车会发出多条一模一样的消息
    if (sending) return

    setSending(true)
    setSendError('')
    try {
      // .select().single() 拿回实际写入的行，配合 checkWriteResult 才能识别
      // 「没有 error 但一行都没写进去」的假成功（RLS 拦截、触发器拦截）
      // 外层再包一层自愈：档案缺失撞外键时先补档案再重试一次
      const { failure } = await runWriteWithProfileHeal(supabase, user, '发送', (client) =>
        client.from('nut_chat_messages').insert({
          chat_id: activeRoom.id,
          user_id: user.id,
          content: input.trim(),
          // 落库定位快照，供 BEFORE INSERT 触发器判定是否在围栏内
          sent_lat: currentLocation?.lat,
          sent_lng: currentLocation?.lng,
        }).select().single()
      )

      if (failure) {
        setSendError(failure)
        return
      }
      setInput('')
    } finally {
      setSending(false)
    }
  }

  if (!activeRoom) {
    return (
      <div className="chat-page">
        <div className="chat-header">
          <h3>💬 我的聊天</h3>
        </div>
        
        <div className="my-rooms-list">
          {myRooms.length === 0 ? (
            <div className="empty-state">
              <p>还没有参与过聊天</p>
              <p>去首页加入一个聊天室吧！</p>
            </div>
          ) : (
            myRooms.map(room => (
              <div 
                key={room.id} 
                className="my-room-item"
                onClick={() => setActiveRoom(room)}
              >
                <div className="room-info">
                  <span className="room-name">{room.name}</span>
                  <span className="room-creator">创建者: {room.nut_users?.username || '未知'}</span>
                </div>
                <span className="room-status">
                  {room.is_active ? '🟢' : '⚪'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  // 不在围栏内：内容置灰 + 只读（对应 PRD 的「离开围栏自动脱敏」）
  return (
    <div className="chat-page">
      <div className="chat-header">
        <button className="back-btn" onClick={handleBack}>← 返回</button>
        <h3 className="room-title">{activeRoom.name}</h3>
        <div className="header-actions">
          <span className="room-type">
            {activeRoom.is_active ? '🟢' : '⚪'}
          </span>
          {isOwner && activeRoom.is_active && (
            <button
              type="button"
              className="room-close-btn"
              onClick={handleCloseRoom}
              disabled={closingRoom}
              title="关闭这个聊天室（聊天记录保留）"
            >
              {closingRoom ? '处理中…' : '关闭'}
            </button>
          )}
        </div>
      </div>

      {!insideFence && (
        <div className="fence-banner">
          🚫 你不在该聊天室的围栏内（{fenceSummary(activeRoom)}），仅可查看历史消息
        </div>
      )}

      <div className={`messages-list${insideFence ? '' : ' fence-locked'}`} ref={listRef}>
        {roomMessages.map(msg => {
          const isOwn = msg.user_id === user?.id
          // 已读人数：排除消息发送者自己
          const readBy = (msg.read_by || []).filter(id => id !== msg.user_id)
          const readCount = readBy.length
          const isRead = readCount > 0

          return (
            <div 
              key={msg.id} 
              className={`message ${isOwn ? 'own' : ''}`}
            >
              <div className="message-avatar">
                {isEmojiAvatar(msg.nut_users?.avatar_url) ? (
                  <span className="avatar-emoji">{msg.nut_users.avatar_url}</span>
                ) : msg.nut_users?.avatar_url ? (
                  <img src={msg.nut_users.avatar_url} alt="" />
                ) : (
                  <span className="avatar-emoji placeholder">
                    {msg.nut_users?.username?.[0] || '?'}
                  </span>
                )}
              </div>
              <div className="message-content">
                <span className="sender">{msg.nut_users?.username}</span>
                <p>{msg.content}</p>
                {isOwn && (
                  <span className={`read-status ${isRead ? 'read' : 'unread'}`}>
                    {isRead ? `已读 ${readCount}` : '未读'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={insideFence ? '说点什么...' : '不在围栏内，无法发言'}
          disabled={!insideFence || sending}
        />
        <button type="submit" disabled={!input.trim() || !insideFence || sending}>
          {sending ? '发送中…' : '发送'}
        </button>
      </form>

      {sendError && <div className="send-error">{sendError}</div>}
    </div>
  )
}
