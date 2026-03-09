export default function NoteCard({ note, horizontal = false }) {
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

  if (horizontal) {
    return (
      <div className="note-card horizontal">
        <div className="note-content">
          <p>{note.content}</p>
        </div>
        <div className="note-meta">
          <span className="author">{note.users?.nickname || '匿名'}</span>
          <span className="expiry">{expiryLabel[note.expiry]}</span>
          <span className="time">{timeAgo(note.created_at)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="note-card">
      <p>{note.content}</p>
      <div className="note-meta">
        <span className="author">{note.users?.nickname || '匿名'}</span>
        <span className="expiry">{expiryLabel[note.expiry]}</span>
        <span className="time">{timeAgo(note.created_at)}</span>
        <span className="likes">❤️ {note.likes_count || 0}</span>
      </div>
    </div>
  )
}
