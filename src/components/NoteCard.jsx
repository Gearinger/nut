import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../stores/useStore'

export default function NoteCard({ note, onRefresh, showActions = true, maxReplies = 3 }) {
  const { user, setActiveTab } = useStore()
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [isLiking, setIsLiking] = useState(false)
  const [localLikes, setLocalLikes] = useState(note.like_counts || 0)
  // liked_by 可能是字符串格式的数组，需要解析
  const parseLikedBy = (likedBy) => {
    if (!likedBy) return []
    if (Array.isArray(likedBy)) return likedBy
    // 处理 PostgreSQL 数组字符串格式 "{uuid1,uuid2}"
    if (typeof likedBy === 'string' && likedBy.startsWith('{')) {
      return likedBy.slice(1, -1).split(',').filter(Boolean)
    }
    return []
  }
  const [localLikedBy, setLocalLikedBy] = useState(parseLikedBy(note.liked_by))
  const [showAllReplies, setShowAllReplies] = useState(false)
  
  // 当前用户是否已点赞
  const isLiked = user && localLikedBy.includes(user.id)

  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000)
    if (seconds < 60) return '刚刚'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`
    return `${Math.floor(seconds / 86400)}天前`
  }

  const expiryLabel = {
    '24h': '快讯',
    '7d': '日常',
    'permanent': '永久'
  }

  const username = note.nut_users?.username || '匿名'
  const replies = note.replies || []
  const hasMoreReplies = replies.length > maxReplies
  const visibleReplies = showAllReplies ? replies : replies.slice(0, maxReplies)

  const handleLike = async () => {
    if (!user || isLiking) return
    setIsLiking(true)

    let newLikedBy
    let newCount
    
    if (isLiked) {
      // 取消点赞
      newLikedBy = localLikedBy.filter(id => id !== user.id)
      newCount = Math.max(0, localLikes - 1)
    } else {
      // 点赞
      newLikedBy = [...localLikedBy, user.id]
      newCount = localLikes + 1
    }
    
    // 乐观更新
    setLocalLikedBy(newLikedBy)
    setLocalLikes(newCount)

    const { error } = await supabase
      .from('nut_messages')
      .update({ like_counts: newCount, liked_by: newLikedBy })
      .eq('id', note.id)

    if (error) {
      console.error('点赞失败:', error)
      // 回滚
      setLocalLikedBy(localLikedBy)
      setLocalLikes(localLikes)
    }
    setIsLiking(false)
  }

  const handleReply = async () => {
    if (!user || !replyText.trim()) return

    const { error } = await supabase.from('nut_message_replies').insert({
      message_id: note.id,
      user_id: user.id,
      content: replyText.trim()
    })

    if (!error) {
      setReplyText('')
      setShowReplyInput(false)
      if (onRefresh) onRefresh()
    }
  }

  const handleViewMore = () => {
    setActiveTab('square')
  }

  return (
    <div className="note-card">
      <div className="note-header">
        <span className="author">👤 {username}</span>
        <span className="time">{timeAgo(note.created_at)}</span>
      </div>
      <p className="note-text">{note.content}</p>
      
      {/* 回复列表 */}
      {replies.length > 0 && (
        <div className="note-replies">
          {visibleReplies.map(reply => (
            <div key={reply.id} className="reply-item">
              <span className="reply-author">{reply.nut_users?.username || '匿名'}</span>
              <span className="reply-content">{reply.content}</span>
            </div>
          ))}
          {hasMoreReplies && !showAllReplies && (
            <div className="replies-more" onClick={handleViewMore}>
              查看全部 {replies.length} 条回复 →
            </div>
          )}
        </div>
      )}

      <div className="note-footer">
        <span className="expiry-tag">{expiryLabel[note.expiry]}</span>
        
        {showActions && user && (
          <div className="note-actions">
            <button 
              className={`action-btn ${isLiked ? 'liked' : ''} ${isLiking ? 'liking' : ''}`}
              onClick={handleLike}
            >
              {isLiked ? '❤️' : '🤍'} {localLikes}
            </button>
            <button 
              className="action-btn"
              onClick={() => setShowReplyInput(!showReplyInput)}
            >
              💬 {replies.length || '回复'}
            </button>
          </div>
        )}
      </div>

      {showReplyInput && (
        <div className="reply-input-wrapper">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="写下你的回复..."
            onKeyDown={(e) => e.key === 'Enter' && handleReply()}
          />
          <button onClick={handleReply} disabled={!replyText.trim()}>发送</button>
        </div>
      )}
    </div>
  )
}
