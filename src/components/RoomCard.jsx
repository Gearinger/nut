export default function RoomCard({ room, onJoin, insideFence = false, fenceText }) {
  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000)
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`
    return `${Math.floor(seconds / 86400)}天前`
  }

  return (
    <div
      className={`room-card${insideFence ? '' : ' outside-fence'}`}
      onClick={() => onJoin(room)}
    >
      <div className="room-info">
        <h4>{room.name}</h4>
        <span className="room-type">
          {room.type === 'temp' ? '⏰ 临时' : '📌 永久'}
        </span>
      </div>
      <div className="room-meta">
        <span className="creator">by {room.nut_users?.username || '未知'}</span>
        <span className="time">{timeAgo(room.created_at)}</span>
      </div>
      {fenceText && (
        <div className="room-fence">
          {insideFence ? '📍 在围栏内 · ' : '🚫 超出围栏 · '}
          {fenceText}
        </div>
      )}
      <button className="join-btn">{insideFence ? '加入' : '仅查看'}</button>
    </div>
  )
}
