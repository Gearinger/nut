import { useState } from 'react'
import { useStore } from '../stores/useStore'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (isLogin) {
      // 登录
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) setError(error.message)
    } else {
      // 注册
      const { error } = await supabase.auth.signUp({
        email,
        password
      })
      if (error) {
        setError(error.message)
      } else {
        alert('注册成功！请登录')
        setIsLogin(true)
      }
    }
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="logo">🐿️ 松鼠</div>
      <h1>位置社交</h1>
      <p>发现附近的精彩</p>
      
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        
        {error && <p className="error">{error}</p>}
        
        <button type="submit" disabled={loading}>
          {loading ? '处理中...' : isLogin ? '登录' : '注册'}
        </button>
      </form>
      
      <p className="switch-mode">
        {isLogin ? '没有账号？' : '已有账号？'}
        <button type="button" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? '注册' : '登录'}
        </button>
      </p>
    </div>
  )
}
