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
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) {
        setError(error.message)
      } else if (data.user) {
        // 确保 nut_users 表中有该用户记录
        // 先检查是否存在
        const { data: existingUser } = await supabase
          .from('nut_users')
          .select('id')
          .eq('id', data.user.id)
          .single()

        if (!existingUser) {
          // 用户不存在，创建新记录
          const { error: insertError } = await supabase.from('nut_users').insert({
            id: data.user.id,
            username: email.split('@')[0]
          })
          if (insertError) {
            console.error('创建用户记录失败:', insertError)
          }
        }
      }
    } else {
      // 注册
      const { data, error } = await supabase.auth.signUp({
        email,
        password
      })
      if (error) {
        setError(error.message)
      } else if (data.user) {
        // 在 nut_users 表中创建用户记录
        const { error: insertError } = await supabase.from('nut_users').insert({
          id: data.user.id,
          username: email.split('@')[0]
        })
        if (insertError) {
          console.error('创建用户记录失败:', insertError)
          // 如果是重复键错误，忽略
          if (!insertError.message.includes('duplicate')) {
            setError('创建用户失败: ' + insertError.message)
            setLoading(false)
            return
          }
        }
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
