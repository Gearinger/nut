import { useEffect } from 'react'
import { useStore } from '../stores/useStore'
import NoteCard from '../components/NoteCard'

export default function SquarePage() {
  const { notes, fetchNotes, currentLocation } = useStore()

  useEffect(() => {
    if (currentLocation) {
      fetchNotes(currentLocation.lat, currentLocation.lng)
    }
  }, [currentLocation])

  const handleRefresh = () => {
    if (currentLocation) {
      fetchNotes(currentLocation.lat, currentLocation.lng)
    }
  }

  const sortedNotes = notes
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return (
    <div className="square-page">
      <div className="square-header">
        <h2>📍 留言广场</h2>
        <p className="subtitle">查看附近的所有留言</p>
      </div>

      <div className="square-list">
        {sortedNotes.length === 0 ? (
          <div className="empty-state">
            <p>附近还没有留言</p>
            <p>成为第一个留言的人吧！</p>
          </div>
        ) : (
          sortedNotes.map(note => (
            <NoteCard 
              key={note.id} 
              note={note} 
              onRefresh={handleRefresh}
              maxReplies={999}
            />
          ))
        )}
      </div>
    </div>
  )
}
