// 此时此地 · 线上发布服务器
// 职责：1) 托管 dist 静态文件；2) 把同源 /supabase/* 反代到自建 Supabase（http），
// 解决 https 页面调用 http 接口被浏览器当混合内容拦截的问题。零依赖，Node 内置模块即可。
//
// ⚠️ 平台网关会把入站 authorization 无条件替换成它自己的会话 JWT（iss=cloudstudio），
// PostgREST 优先验证 authorization，导致 apikey 失效（PGRST301）。
// 对策：① 前端把 Supabase 的 authorization 挪到 x-sb-auth（见 src/lib/supabase.js）；
//      ② 这里优先用 x-sb-auth 还原 authorization；没有时，若入站 authorization 是平台
//        token（iss 含 cloudstudio）则删掉，让 PostgREST 回退用 apikey（anon 角色）。

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = process.env.PORT || 3000
const TARGET = new URL(process.env.SUPABASE_TARGET || 'http://42.121.101.179')
const ROOT = path.join(__dirname, 'site')
const PREFIX = '/supabase/'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === PREFIX.slice(0, -1) || url.pathname.startsWith(PREFIX)) {
    return proxy(req, res, url)
  }
  return serveStatic(req, res, url)
})

function isPlatformToken(v) {
  try {
    const jwt = String(v).replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'))
    return String(payload.iss || '').includes('cloudstudio')
  } catch {
    return false
  }
}

// —— 反代：/supabase/rest/v1/... → http://TARGET/rest/v1/... ——
function proxy(req, res, url) {
  const headers = { ...req.headers, host: TARGET.host }
  const sbAuth = headers['x-sb-auth']
  if (sbAuth) {
    headers['authorization'] = Array.isArray(sbAuth) ? sbAuth[0] : sbAuth
  } else if (headers['authorization'] && isPlatformToken(headers['authorization'])) {
    delete headers['authorization']
  }
  delete headers['x-sb-auth']

  const upstreamPath = url.pathname.startsWith(PREFIX)
    ? url.pathname.slice(PREFIX.length - 1) // 保留开头 /
    : '/'
  const cleanPath = upstreamPath.replace(/\/{2,}/g, '/') // 归一化双斜杠
  const options = {
    hostname: TARGET.hostname,
    port: TARGET.port || 80,
    path: cleanPath + url.search,
    method: req.method,
    headers,
  }
  const upstream = http.request(options, (r) => {
    res.writeHead(r.statusCode || 502, r.headers)
    r.pipe(res)
  })
  upstream.on('error', (err) => {
    console.error('proxy error:', err.message)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'upstream unreachable', detail: err.message }))
  })
  req.pipe(upstream)
}

// —— 静态文件 + SPA 兜底 ——
//
// 缓存策略（很重要）：
//   index.html 不带 hash，浏览器若无缓存头会启发式缓存，部署新版本后
//   用户仍然加载旧 bundle → 出现“改了没生效/白屏/旧接口地址”这类玄学问题。
//   所以：html 一律 no-cache；assets 带 hash，可放心一年缓存。
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname)
  if (p === '/') p = '/index.html'
  const file = path.normalize(path.join(ROOT, p))
  if (!file.startsWith(ROOT)) {
    res.writeHead(403)
    return res.end('forbidden')
  }
  const isHtml = file.endsWith('.html')
  const cacheControl = isHtml
    ? 'no-cache, no-store, must-revalidate'
    : 'public, max-age=31536000, immutable'
  fs.readFile(file, (err, data) => {
    if (err) {
      // 未命中文件时回退到 index.html（SPA 习惯性兜底）
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) {
          res.writeHead(404)
          return res.end('not found')
        }
        res.writeHead(200, {
          'content-type': MIME['.html'],
          'cache-control': 'no-cache, no-store, must-revalidate',
        })
        res.end(html)
      })
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': cacheControl,
    })
    res.end(data)
  })
}

server.listen(PORT, '0.0.0.0', () => console.log(`listening on ${PORT}`))
