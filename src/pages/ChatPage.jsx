import { useState, useEffect, useRef } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'

export default function ChatPage() {
  const { activeRoom, messages, fetchMessages, markMessagesAsRead, user, myRooms, fetchMyRooms, setActiveRoom } = useStore()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef()

  // 获取用户参与的聊天室
  useEffect(() => {
    if (user) {
      fetchMyRooms(user.id)
    }
  }, [user])

  useEffect(() => {
    if (!activeRoom) return

    fetchMessages(activeRoom.id)
    
    // 实时订阅新消息
    const channel = supabase
      .channel(`room:${activeRoom.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'nut_chat_messages',
        filter: `chat_id=eq.${activeRoom.id}`
      }, () => {
        // 收到新消息或更新时重新获取整个消息列表
        fetchMessages(activeRoom.id)
      })
      .subscribe((status) => {
        console.log('Realtime status:', status)
      })

    // 备用：每3秒轮询一次（确保实时订阅失效时也能更新）
    const pollInterval = setInterval(() => {
      fetchMessages(activeRoom.id)
    }, 3000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollInterval)
    }
  }, [activeRoom?.id])

  // 进入聊天室时标记消息为已读
  useEffect(() => {
    if (activeRoom && user) {
      // 延迟标记为已读，确保消息已加载
      const timer = setTimeout(() => {
        markMessagesAsRead(activeRoom.id, user.id)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [activeRoom?.id])
  
  // 消息列表更新时也标记已读
  useEffect(() => {
    const roomMessages = messages[activeRoom?.id]
    if (activeRoom && user && roomMessages && roomMessages.length > 0) {
      markMessagesAsRead(activeRoom.id, user.id)
    }
  }, [messages[activeRoom?.id]])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages[activeRoom?.id]])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || !activeRoom) return

    const { error } = await supabase.from('nut_chat_messages').insert({
      chat_id: activeRoom.id,
      user_id: user.id,
      content: input.trim()
    })

    if (!error) {
      setInput('')
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

  const roomMessages = messages[activeRoom.id] || []

  return (
    <div className="chat-page">
      <div className="chat-header">
        <button className="back-btn" onClick={handleBack}>← 返回</button>
        <h3 className="room-title">{activeRoom.name}</h3>
        <span className="room-type">
          {activeRoom.is_active ? '🟢' : '⚪'}
        </span>
      </div>

      <div className="messages-list">
        {roomMessages.map(msg => {
          const isOwn = msg.user_id === user.id
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
                {msg.nut_users?.avatar_url ? (
                  <img src={msg.nut_users.avatar_url} alt="" />
                ) : (
                  <div className="avatar-placeholder">
                    {msg.nut_users?.username?.[0] || '?'}
                  </div>
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
          placeholder="说点什么..."
        />
        <button type="submit" disabled={!input.trim()}>发送</button>
      </form>
    </div>
  )
}
