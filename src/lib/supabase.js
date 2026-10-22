import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'

// 线上走同源反代时（VITE_SUPABASE_URL 指向本站 /supabase），
// 发布平台的网关会无条件把 authorization 覆盖成它自己的会话 JWT，
// 导致 PostgREST 验证失败（PGRST301）、登录态丢失。
// 对策：用官方 global.fetch 扩展点，把 Supabase 的 authorization 挪到
// x-sb-auth，由反向代理在服务端还原（见 deploy/server.js）。
// 直连场景（本地 dev 直连 Supabase）不受影响。
const isProxied = /\/supabase$/.test(supabaseUrl)

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: isProxied
    ? {
        fetch: (input, init = {}) => {
          const headers = new Headers(init.headers || undefined)
          if (input instanceof Request) {
            input.headers.forEach((v, k) => {
              if (!headers.has(k)) headers.set(k, v)
            })
          }
          const auth = headers.get('authorization')
          if (auth) {
            headers.set('x-sb-auth', auth)
            headers.delete('authorization')
          }
          return fetch(input, { ...init, headers })
        },
      }
    : undefined,
})
