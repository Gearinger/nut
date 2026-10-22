import { useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  flowerEmail,
  validateFlowerName,
  FLOWER_NAME_MAX,
  FLOWER_PASSWORD,
  ensureProfile,
} from '../lib/flowerAuth'

/**
 * 花名登录：填个花名 / 企微名直接进，不注册、不要邮箱密码。
 *
 * 底层仍然是 Supabase Auth（RLS 要用到 auth.uid()），
 * 所以做法是「花名 → 确定性邮箱 → 自动登录」：
 * 先尝试登录，没注册过就自动注册，同名花名会落到同一个账号。
 */
export default function LoginPage() {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    const displayName = name.trim()
    const invalid = validateFlowerName(displayName)
    if (invalid) {
      setError(invalid)
      return
    }
    if (loading) return // 防重复提交

    setLoading(true)
    setError('')
    try {
      const email = flowerEmail(displayName)

      // 先按已注册的用户登录；失败说明这个名字还没用过，自动注册一个
      const signed = await supabase.auth.signInWithPassword({
        email,
        password: FLOWER_PASSWORD,
      })
      let data = signed.data

      if (!data?.user) {
        const up = await supabase.auth.signUp({ email, password: FLOWER_PASSWORD })
        if (up.error && !up.data?.user) {
          // 注册也失败（服务不可达 / 实例关闭注册）才报错
          setError('进入失败：' + (up.error.message || signed.error?.message || '未知错误'))
          return
        }
        data = up.data
      }

      const userId = data?.user?.id
      if (!userId) {
        setError('进入失败：没有拿到登录身份，请重试')
        return
      }

      const profileError = await ensureProfile(supabase, userId, displayName)
      if (profileError) {
        setError(profileError)
        return
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="logo">🐿️ 松鼠</div>
      <h1>位置社交</h1>
      <p>发现附近的精彩</p>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="你的花名 / 企微名"
          maxLength={FLOWER_NAME_MAX}
          autoFocus
        />

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading || !name.trim()}>
          {loading ? '进入中...' : '进入'}
        </button>
      </form>

      <p className="login-hint">
        不用注册，填个名字就能用。换台设备填同一个名字，还是你的数据。
      </p>
    </div>
  )
}
