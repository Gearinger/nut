import { useState, useEffect, useRef } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'

export default function ChatPage() {
  const { activeRoom, messages, fetchMessages, setMessages, user } = useStore()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef()

  useEffect(() => {
    if (activeRoom) {
      fetchMessages(activeRoom.id)
      
      // Subscribe to new messages
      const channel = supabase
        .channel(`room:${activeRoom.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${activeRoom.id}`
        }, (payload) => {
          const newMessage = payload.new
          // Fetch full message with user info
          supabase
            .from('messages')
            .select('*, users(nickname, avatar_url)')
            .eq('id', newMessage.id)
            .single()
            .then(({ data }) => {
              if (data) {
                const currentMessages = messages[activeRoom.id] || []
                setMessages(activeRoom.id, [...currentMessages, data])
              }
            })
        })
        .subscribe()

      return () => supabase.removeChannel(channel)
    }
  }, [activeRoom?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages[activeRoom?.id]])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim() || !activeRoom) return

    const { error } = await supabase.from('messages').insert({
      room_id: activeRoom.id,
      user_id: user.id,
      content: input.trim(),
      type: 'text'
    })

    if (!error) {
      setInput('')
    }
  }

  if (!activeRoom) {
    return (
      <div className="chat-page empty">
        <p>选择一个聊天室开始聊天</p>
      </div>
    )
  }

  const roomMessages = messages[activeRoom.id] || []

  return (
    <div className="chat-page">
      <div className="chat-header">
        <h3>{activeRoom.name}</h3>
        <span className="room-type">
          {activeRoom.type === 'temp' ? '⏰ 临时' : '📌 永久'}
        </span>
      </div>

      <div className="messages-list">
        {roomMessages.map(msg => (
          <div 
            key={msg.id} 
            className={`message ${msg.user_id === user.id ? 'own' : ''}`}
          >
            <div className="message-avatar">
              {msg.users?.avatar_url ? (
                <img src={msg.users.avatar_url} alt="" />
              ) : (
                <div className="avatar-placeholder">
                  {msg.users?.nickname?.[0] || '?'}
                </div>
              )}
            </div>
            <div className="message-content">
              <span className="sender">{msg.users?.nickname}</span>
              <p>{msg.content}</p>
            </div>
          </div>
        ))}
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
