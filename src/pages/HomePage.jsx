import { useState, useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useStore } from '../stores/useStore'
import NoteCard from '../components/NoteCard'
import RoomCard from '../components/RoomCard'
import WriteNoteModal from '../components/WriteNoteModal'
import CreateRoomModal from '../components/CreateRoomModal'

export default function HomePage() {
  const { 
    currentLocation, setCurrentLocation,
    notes, rooms, setActiveTab, setActiveRoom,
    fetchNotes, fetchRooms
  } = useStore()
  
  const mapContainer = useRef(null)
  const map = useRef(null)
  const [viewState, setViewState] = useState({
    latitude: 31.2304,
    longitude: 121.4737,
    zoom: 14
  })
  const [selectedNote, setSelectedNote] = useState(null)
  const [showWriteModal, setShowWriteModal] = useState(false)
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false)

  // Initialize map
  useEffect(() => {
    if (map.current) return

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom
    })

    map.current.on('move', () => {
      setViewState({
        latitude: map.current.getCenter().lat,
        longitude: map.current.getCenter().lng,
        zoom: map.current.getZoom()
      })
    })
  })

  // Get current location
  useEffect(() => {
    // 默认位置（上海）
    const defaultLocation = { lat: 31.2304, lng: 121.4737 }
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          setCurrentLocation({ lat: latitude, lng: longitude })
          map.current?.flyTo({ center: [longitude, latitude], zoom: 14 })
        },
        (err) => {
          console.warn('定位失败，使用默认位置:', err.message)
          setCurrentLocation(defaultLocation)
        },
        { timeout: 5000, maximumAge: 60000 }
      )
    } else {
      setCurrentLocation(defaultLocation)
    }
  }, [])

  const handleNoteClick = (note) => {
    setSelectedNote(note)
  }

  const handleJoinRoom = (room) => {
    setActiveRoom(room)
    setActiveTab('chat')
  }

  const handleRefreshNotes = () => {
    if (currentLocation) {
      fetchNotes(currentLocation.lat, currentLocation.lng)
    }
  }

  return (
    <div className="home-page">
      <div className="map-container" ref={mapContainer} />

      {/* Bottom sheets */}
      <div className="bottom-sheet">
        <div className="nearby-list">
          <h3>📝 附近留言 ({notes.length})</h3>
          <div className="notes-list">
            {notes
              .slice()
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .slice(0, 5)
              .map(note => (
                <NoteCard key={note.id} note={note} onRefresh={handleRefreshNotes} />
              ))}
          </div>
          
          <h3>💬 热门聊天 ({rooms.length})</h3>
          <div className="rooms-scroll">
            {rooms.slice(0, 3).map(room => (
              <RoomCard key={room.id} room={room} onJoin={handleJoinRoom} />
            ))}
          </div>
        </div>
      </div>

      {/* FAB buttons */}
      <button className="fab note-fab" onClick={() => setShowWriteModal(true)}>
        📝
      </button>
      <button className="fab room-fab" onClick={() => setShowCreateRoomModal(true)}>
        💬
      </button>

      {/* Modals */}
      {showWriteModal && (
        <WriteNoteModal 
          location={currentLocation} 
          onClose={() => setShowWriteModal(false)}
          onSuccess={handleRefreshNotes}
        />
      )}
      {showCreateRoomModal && (
        <CreateRoomModal 
          onClose={() => setShowCreateRoomModal(false)}
          onSuccess={fetchRooms}
        />
      )}
    </div>
  )
}
