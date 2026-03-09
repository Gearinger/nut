import { useState } from 'react'
import { useStore } from '../stores/useStore'

export default function LoginPage() {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const { signIn } = useStore()

  const handleSendCode = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await signIn(phone)
    if (error) {
      alert(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="logo">🐿️ 松鼠</div>
      <h1>位置社交</h1>
      <p>发现附近的精彩</p>
      
      {!sent ? (
        <form onSubmit={handleSendCode}>
          <input
            type="tel"
            placeholder="手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? '发送中...' : '发送验证码'}
          </button>
        </form>
      ) : (
        <div className="otp-form">
          <p>验证码已发送到 {phone}</p>
          <input type="text" placeholder="输入验证码" maxLength={6} />
          <button>登录</button>
        </div>
      )}
    </div>
  )
}
