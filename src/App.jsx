import { useState, useEffect } from 'react'
import { useStore } from './stores/useStore'
import { supabase } from './lib/supabase'
import { ensureProfile, nameFromFlowerEmail } from './lib/flowerAuth'
import HomePage from './pages/HomePage'
import SquarePage from './pages/SquarePage'
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
      // 整段必须 try/catch：建档这里一旦抛异常（网络超时、服务不可达），
      // 没有兜底的话 setLoading(false) 永远不会执行，页面会一直卡在「加载中...」。
      let session = null
      try {
        ;({ data: { session } } = await supabase.auth.getSession())
        if (session?.user) {
          // 恢复旧会话时档案行可能已经不存在（例如清理过测试数据、
          // 或同一花名在别处被重建）——不补建的话，进主页后发任何内容
          // 都会撞 nut_messages 的外键约束。登录页有同样的建档逻辑，
          // 但这条恢复路径不经过登录页，所以必须在这里补一次。
          const profileError = await ensureProfile(
            supabase,
            session.user.id,
            nameFromFlowerEmail(session.user.email)
          )
          if (profileError) {
            // 档案都建不出来说明会话/库状态异常，
            // 退回登录页让用户重新走一遍（登录路径会再次尝试建档）。
            console.warn('恢复会话时补建档案失败：', profileError)
            await supabase.auth.signOut()
            useStore.getState().setUser(null)
          } else {
            useStore.getState().setUser(session.user)
          }
        }
      } catch (err) {
        // 网络异常不该把用户锁死在加载态：会话还在就放他进去，
        // 真缺档案的话写操作层（runWriteWithProfileHeal）还有一次自愈。
        console.warn('恢复会话失败：', err)
        if (session?.user) useStore.getState().setUser(session.user)
      } finally {
        setLoading(false)
      }
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
        {activeTab === 'square' && <SquarePage />}
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
          className={`tab ${activeTab === 'square' ? 'active' : ''}`}
          onClick={() => setActiveTab('square')}
        >
          📍 广场
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
