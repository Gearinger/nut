/**
 * 把 PostgREST / Supabase 的晦涩报错翻译成「下一步该做什么」。
 *
 * 最典型的一类：数据库没跑迁移时，接口会报
 *   Could not find the 'latitude' column of 'nut_chats' in the schema cache
 * 这句话看不出根因是「表结构没更新」，只会被当成代码 bug。
 */

const SCHEMA_CACHE_RE =
  /Could not find the '([^']+)' column of '([^']+)' in the schema cache/i

/**
 * 缺列 / 缺函数时统一指向这一份脚本。
 *
 * 为什么不按表分不同脚本：早期版本把缺列一律指向 fence_migration.sql，
 * 结果线上报「缺少 nut_chat_messages.sent_lat」时，用户照提示跑完
 * fence_migration.sql 依然报同样的错 —— sent_lat 其实在另一份脚本里。
 * 提示指错脚本比不提示更糟：用户会以为脚本没生效，反复重跑。
 * 现在全部合成 fix_all.sql（幂等，跑一次全补齐），提示只给这一个名字。
 */
const FIX_ALL_SQL = 'supabase/fix_all.sql'

export function describeDbError(error) {
  const raw = (error && error.message) || String(error || '未知错误')

  const cacheMiss = SCHEMA_CACHE_RE.exec(raw)
  if (cacheMiss) {
    const [, column, table] = cacheMiss
    return (
      `数据库缺少字段 ${table}.${column}。\n` +
      `请在 Supabase 控制台执行 ${FIX_ALL_SQL}` +
      `（脚本末尾会自动刷新接口缓存），然后重试。\n\n原始信息：${raw}`
    )
  }

  // 典型：Could not find the function public.toggle_note_like(...) in the schema cache
  const fnMiss = /Could not find the function\s+([^(\s]+)/i.exec(raw)
  if (fnMiss) {
    return (
      `数据库缺少函数 ${fnMiss[1]}。\n` +
      `请在 Supabase 控制台执行 ${FIX_ALL_SQL}` +
      `（内含这些函数的定义，脚本末尾会自动刷新接口缓存）。\n\n原始信息：${raw}`
    )
  }

  if (/violates row-level security/i.test(raw)) {
    return (
      `被数据库权限（RLS）拒绝：当前账号没有这张表的写入权限。\n` +
      `请检查对应表的 insert 策略是否对 authenticated 角色开放。\n\n原始信息：${raw}`
    )
  }

  if (/violates foreign key constraint/i.test(raw)) {
    // 绝大多数情况是「有登录身份、但没有 nut_users 档案行」，
    // 这类自愈不了时才提示用户动手。
    return (
      `关联数据不存在（外键约束）：通常是 nut_users 里还没有当前用户的档案记录。\n` +
      `刷新页面一般会补建；还不行就退出重新填一次花名。\n\n` +
      `原始信息：${raw}`
    )
  }

  if (/duplicate key value/i.test(raw)) {
    return `已存在同名记录，换一个名字试试。\n\n原始信息：${raw}`
  }

  return raw
}

/**
 * 校验写操作（insert / update / upsert）的真实结果。
 *
 * 为什么不能只判 error：
 *   PostgREST 的写操作在「RLS 拦截」「命中 0 行」「触发器吞掉」等场景下，
 *   error 可能是 null，但实际上一行都没写进去。只看 error 会让界面显示
 *   「保存成功」，刷新后数据却原封不动——这是最难排查的一类 bug。
 *
 * 用法：
 *   const { data, error } = await supabase.from('t').insert(x).select().single()
 *   const msg = checkWriteResult({ data, error }, '发送')
 *   if (msg) { setError(msg); return }   // msg 为 null 才是真的成功
 *
 * @returns {string|null} null 表示确实写入成功，否则是可直接展示的错误文案
 */
export function checkWriteResult(result, action = '保存') {
  const error = result && result.error
  if (error) return `${action}失败：${describeDbError(error)}`

  const data = result ? result.data : null
  // 空数组同样代表「一行都没写进去」（不带 .single() 时 PostgREST 返回 []）
  const wrote = data !== null && data !== undefined && !(Array.isArray(data) && data.length === 0)
  if (!wrote) {
    return `${action}失败：数据库没有写入任何记录（通常是权限策略拦截），请稍后重试`
  }
  return null
}

export default describeDbError
