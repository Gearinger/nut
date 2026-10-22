import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../stores/useStore'
import { checkWriteResult, describeDbError } from '../lib/dbError'

// liked_by 可能是 PostgreSQL 数组字符串格式 "{uuid1,uuid2}"，需要解析
const parseLikedBy = (likedBy) => {
  if (!likedBy) return []
  if (Array.isArray(likedBy)) return likedBy
  if (typeof likedBy === 'string' && likedBy.startsWith('{')) {
    return likedBy.slice(1, -1).split(',').filter(Boolean)
  }
  return []
}

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
  'permanent': '永久',
  'expired': '已过期'
}

// 数据库写入的是 expires_at 时间戳，据此反推时效档位（兼容旧的 expiry 字段）
const getExpiryKey = (item) => {
  if (item.expiry) return item.expiry
  if (!item.expires_at) return 'permanent'
  const hours = (new Date(item.expires_at).getTime() - Date.now()) / 3600000
  if (hours <= 0) return 'expired'
  if (hours <= 24) return '24h'
  if (hours <= 168) return '7d'
  return 'permanent'
}

export default function NoteCard({ note, onRefresh, showActions = true, maxReplies = 3 }) {
  const { user, setActiveTab } = useStore()
  const [showReplyInput, setShowReplyInput] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [isLiking, setIsLiking] = useState(false)
  const [isReplying, setIsReplying] = useState(false)
  const [replyError, setReplyError] = useState('')
  const [localLikes, setLocalLikes] = useState(note.like_counts || 0)
  const [localLikedBy, setLocalLikedBy] = useState(parseLikedBy(note.liked_by))

  // 请求进行中不回灌，否则会打断乐观更新；空闲时以服务端数据为准，
  // 这样别人点的赞和刷新后的最新计数都能同步过来
  useEffect(() => {
    if (isLiking) return
    setLocalLikes(note.like_counts || 0)
    setLocalLikedBy(parseLikedBy(note.liked_by))
  }, [note.like_counts, note.liked_by, isLiking])

  // 当前用户是否已点赞
  const isLiked = user && localLikedBy.includes(user.id)

  const username = note.nut_users?.username || '匿名'
  const replies = note.replies || []
  const hasMoreReplies = replies.length > maxReplies
  const visibleReplies = replies.slice(0, maxReplies)

  const handleLike = async () => {
    if (!user || isLiking) return
    setIsLiking(true)

    const prevLikedBy = localLikedBy
    const prevLikes = localLikes

    // 先乐观更新，最终以服务端返回值为准
    setLocalLikedBy(
      isLiked ? prevLikedBy.filter(id => id !== user.id) : [...prevLikedBy, user.id]
    )
    setLocalLikes(isLiked ? Math.max(0, prevLikes - 1) : prevLikes + 1)

    // 计数与去重在数据库事务内完成，客户端无法伪造，也不会并发覆盖
    const { data, error } = await supabase.rpc('toggle_note_like', {
      p_message_id: note.id,
      p_user_id: user.id,
    })

    const updated = data?.[0]
    if (error || !updated) {
      // 回滚。失败原因要留痕——最常见的是数据库里还没有 toggle_note_like 函数
      console.warn('点赞失败:', describeDbError(error || '没有返回更新后的记录'))
      setLocalLikedBy(prevLikedBy)
      setLocalLikes(prevLikes)
    } else {
      setLocalLikedBy(parseLikedBy(updated.liked_by))
      setLocalLikes(updated.like_counts || 0)
    }
    setIsLiking(false)
  }

  const handleReply = async () => {
    if (!user || !replyText.trim()) return
    // 防重复提交：连点回复会发出多条一模一样的回复
    if (isReplying) return

    setIsReplying(true)
    setReplyError('')
    try {
      const result = await supabase.from('nut_message_replies').insert({
        message_id: note.id,
        user_id: user.id,
        content: replyText.trim()
      }).select().single()

      // 不只看 error：RLS 拦截时可能没有 error，但一行都没写进去
      const failure = checkWriteResult(result, '回复')
      if (failure) {
        setReplyError(failure)
        return
      }

      setReplyText('')
      setShowReplyInput(false)
      if (onRefresh) onRefresh()
    } finally {
      setIsReplying(false)
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
          {hasMoreReplies && (
            <div className="replies-more" onClick={handleViewMore}>
              查看全部 {replies.length} 条回复 →
            </div>
          )}
        </div>
      )}

      <div className="note-footer">
        <span className="expiry-tag">{expiryLabel[getExpiryKey(note)]}</span>
        
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
            disabled={isReplying}
          />
          <button onClick={handleReply} disabled={!replyText.trim() || isReplying}>
            {isReplying ? '发送中…' : '发送'}
          </button>
          {replyError && <p className="reply-error">{replyError}</p>}
        </div>
      )}
    </div>
  )
}
