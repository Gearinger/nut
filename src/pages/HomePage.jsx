import { useState, useEffect, useRef } from 'react'
import Map, { Marker, Popup } from 'react-map-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'
import NoteCard from '../components/NoteCard'
import RoomCard from '../components/RoomCard'
import WriteNoteModal from '../components/WriteNoteModal'
import CreateRoomModal from '../components/CreateRoomModal'

// Maplibre 使用免费图床，无需 Token

export default function HomePage() {
  const { 
    currentLocation, setCurrentLocation,
    notes, rooms, setActiveTab, setActiveRoom
  } = useStore()
  
  const [viewState, setViewState] = useState({
    latitude: 31.2304,
    longitude: 121.4737,
    zoom: 14
  })
  const [selectedNote, setSelectedNote] = useState(null)
  const [showWriteModal, setShowWriteModal] = useState(false)
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false)
  const mapRef = useRef()

  // Get current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          setCurrentLocation({ lat: latitude, lng: longitude })
          setViewState({ ...viewState, latitude, longitude })
        },
        (err) => console.error('定位失败:', err)
      )
    }
  }, [])

  const handleNoteClick = (note) => {
    setSelectedNote(note)
  }

  const handleJoinRoom = (room) => {
    setActiveRoom(room)
    setActiveTab('chat')
  }

  return (
    <div className="home-page">
      <div className="map-container">
        <Map
          ref={mapRef}
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          style={{ width: '100%', height: '100%' }}
          mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
        >
          {/* Current location marker */}
          {currentLocation && (
            <Marker 
              latitude={currentLocation.lat} 
              longitude={currentLocation.lng}
              anchor="center"
            >
              <div className="current-location-marker">📍</div>
            </Marker>
          )}

          {/* Note markers */}
          {notes.map(note => (
            <Marker
              key={note.id}
              latitude={note.lat}
              longitude={note.lng}
              anchor="bottom"
              onClick={e => {
                e.originalEvent.stopPropagation()
                handleNoteClick(note)
              }}
            >
              <div className="note-marker">📝</div>
            </Marker>
          ))}

          {/* Room markers */}
          {rooms.map(room => (
            <Marker
              key={room.id}
              latitude={room.lat}
              longitude={room.lng}
              anchor="bottom"
            >
              <div className="room-marker" onClick={() => handleJoinRoom(room)}>
                💬
              </div>
            </Marker>
          ))}

          {/* Note popup */}
          {selectedNote && (
            <Popup
              latitude={selectedNote.lat}
              longitude={selectedNote.lng}
              anchor="top"
              onClose={() => setSelectedNote(null)}
            >
              <NoteCard note={selectedNote} />
            </Popup>
          )}
        </Map>
      </div>

      {/* Bottom sheets */}
      <div className="bottom-sheet">
        <div className="nearby-list">
          <h3>📝 附近留言 ({notes.length})</h3>
          <div className="notes-scroll">
            {notes.slice(0, 5).map(note => (
              <NoteCard key={note.id} note={note} horizontal />
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
        />
      )}
      {showCreateRoomModal && (
        <CreateRoomModal 
          location={currentLocation} 
          onClose={() => setShowCreateRoomModal(false)} 
        />
      )}
    </div>
  )
}
