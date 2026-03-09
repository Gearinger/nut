import { useState, useEffect } from 'react'
import { useStore } from './stores/useStore'
import { supabase } from './lib/supabase'
import HomePage from './pages/HomePage'
import ChatPage from './pages/ChatPage'
import ProfilePage from './pages/ProfilePage'
import LoginPage from './pages/LoginPage'
import './App.css'

function App() {
  const { user, activeTab, setActiveTab, fetchNotes, fetchRooms, currentLocation } = useStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check auth state
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        useStore.getState().setUser(session.user)
      }
      setLoading(false)
    }
    checkAuth()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      useStore.getState().setUser(session?.user || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Fetch data when location changes
  useEffect(() => {
    if (currentLocation) {
      fetchNotes(currentLocation.lat, currentLocation.lng)
      fetchRooms(currentLocation.lat, currentLocation.lng)
    }
  }, [currentLocation])

  if (loading) {
    return <div className="loading">加载中...</div>
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <div className="app">
      <div className="content">
        {activeTab === 'home' && <HomePage />}
        {activeTab === 'chat' && <ChatPage />}
        {activeTab === 'profile' && <ProfilePage />}
      </div>
      
      <nav className="tab-bar">
        <button 
          className={`tab ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => setActiveTab('home')}
        >
          🏠 首页
        </button>
        <button 
          className={`tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          💬 消息
        </button>
        <button 
          className={`tab ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          👤 我的
        </button>
      </nav>
    </div>
  )
}

export default App
