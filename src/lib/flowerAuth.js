/**
 * 花名登录：不注册、不填邮箱密码，输入花名 / 企微名直接进。
 *
 * 底层仍是 Supabase Auth（RLS 依赖 auth.uid()，不能不走登录），
 * 做法是「花名 → 确定性邮箱 → 自动登录」：
 *   花名  →  <slug>-<hash>@nut.local
 *   固定密码
 *   先 signIn，失败（还未注册过）就 signUp；同名花名会落到同一个账号，
 *   所以换台设备填同样的名字还能回到自己的数据。
 *
 * ⚠️ 安全权衡：密码是前端固定值，知道规则的人可以用别人的花名登录。
 *    这是内部演示 / 比赛的取舍——换来的好处是零门槛体验。
 *    若要真实身份体系，应换成企业微信 OAuth，而不是在这里加密码。
 */

import { checkWriteResult, describeDbError } from './dbError.js'
import { randomAvatar } from './avatar.js'

/** 固定密码：仅用于把花名映射成可登录账号，不承担安全职责 */
export const FLOWER_PASSWORD = 'nut-flower-login'

/** 花名允许的展示长度（超出在 UI 层拦截） */
export const FLOWER_NAME_MAX = 20

/**
 * 32 位字符串哈希，转 36 进制。
 * 中文花名没法直接进邮箱（本地部分只允许 ASCII），
 * 用哈希保证「同名 → 同邮箱」，同时保持邮箱合法。
 */
export function hashCode(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** 花名 → 合法且确定性的邮箱 */
export function flowerEmail(displayName) {
  // 归一化后再算 slug 和 hash：否则「Hermy」和「hermy」会落到两个不同账号，
  // 用户换个大小写就找不到自己的数据了。
  const name = String(displayName || '').trim().toLowerCase()
  const slug = name
    .replace(/[^a-z0-9._-]/g, '') // 中文等字符直接剔掉，剩下可读部分
    .slice(0, 24)
  return `${slug || 'u'}-${hashCode(name)}@nut.local`
}

/** 花名合法性校验，返回空字符串表示通过 */
export function validateFlowerName(name) {
  const value = String(name || '').trim()
  if (!value) return '请填写花名'
  if (value.length > FLOWER_NAME_MAX) return `花名最多 ${FLOWER_NAME_MAX} 个字符`
  return ''
}

/**
 * 从确定性邮箱反推展示名，用于「恢复旧会话时补建档案」。
 *
 * 为什么需要：登录页会建档，但 App 启动时从 localStorage 恢复的旧会话
 * 不经过登录页。若档案行后来没了（如清理过测试数据、或账号在别的设备
 * 被重建），后续所有写操作都会撞 nut_messages 的外键约束。
 * 此时只能从 email（hermy-1n1im9@nut.local）反推名字。
 * 中文花名的 slug 本来就是空的，只能落回「用户」，可在个人页改。
 */
export function nameFromFlowerEmail(email) {
  const raw = String(email || '')
  // 老邮箱密码账号（非 @nut.local）没有 slug-hash 结构，反推不出花名
  if (!raw.endsWith('@nut.local')) return '用户'
  const local = raw.split('@')[0] || ''
  const m = /^(.*)-[0-9a-z]+$/.exec(local)
  return (m && m[1]) || local || '用户'
}

/**
 * 保证 nut_users 里有该用户的档案。
 *
 * 必须在两条路径都调用：
 *   ① 登录页（花名登录成功后）
 *   ② App 启动从 localStorage 恢复旧会话时
 * 只在①调用的话，就会出现「能进主页但发什么都报外键约束」的暗坑。
 *
 * 返回 null 表示档案就绪，否则是可直接展示的错误文案。
 */
export async function ensureProfile(supabaseClient, userId, displayName) {
  // 先查再写，而不是直接 upsert：
  // 无条件 upsert 会在每次启动 / 每次登录时把 username 覆盖回「从邮箱反推的名字」，
  // 用户在个人页改过的昵称一刷新就没了。档案已存在时必须什么都不做。
  const existing = await supabaseClient
    .from('nut_users')
    .select('id, avatar_url')
    .eq('id', userId)
    .maybeSingle()

  if (existing.error) {
    return `初始化用户档案失败：${describeDbError(existing.error)}`
  }

  // 已有档案：只补「还没头像」这一种缺失，绝不覆盖用户自己选的头像和昵称
  if (existing.data) {
    if (!existing.data.avatar_url) {
      await assignRandomAvatar(supabaseClient, userId)
    }
    return null
  }

  const result = await supabaseClient
    .from('nut_users')
    .insert({ id: userId, username: displayName, avatar_url: randomAvatar() })
    .select()
    .single()
  return checkWriteResult(result, '初始化用户档案')
}

/**
 * 首次进入给个随机 emoji 头像。
 * 失败不抛错也不返回文案：头像只是锦上添花，
 * 不该因为它把用户挡在门外（App 启动建档失败会退回登录页）。
 */
async function assignRandomAvatar(supabaseClient, userId) {
  const result = await supabaseClient
    .from('nut_users')
    .update({ avatar_url: randomAvatar() })
    .eq('id', userId)
    .select('id')
  if (result.error || !result.data?.length) {
    console.warn('随机头像分配失败：', result.error?.message || '没有写入任何记录')
  }
}

/** 是否是「用户档案缺失」导致的外键错误（user_id 外键撞墙） */
export function isProfileMissingError(message) {
  return /violates foreign key constraint/i.test(String(message || '')) &&
    /user_id/i.test(String(message || ''))
}

/**
 * 执行写操作；若因档案缺失撞外键，自动补建档案后重试一次。
 *
 * 为什么需要：档案可能因为各种路径缺失（旧会话恢复失败、数据在别处被清理、
 * 账号重建等），而用户此刻根本不知道自己缺档案，只看到一条看不懂的外键报错。
 * 与其让他去刷新页面碰运气，不如在写操作这一层就地自愈。
 *
 * @param {(supabase:any)=>Promise<{data:any,error:any}>} run 真正执行的写操作
 * @returns {Promise<{failure:string|null}>} null 表示成功
 */
export async function runWriteWithProfileHeal(supabaseClient, user, action, run) {
  const first = await run(supabaseClient)
  const failure = checkWriteResult(first, action)
  if (!failure) return { failure: null }

  // 只针对「档案缺失」这一类错误自愈；别的错误（RLS、围栏、缺列）原样返回，
  // 避免把真实错误埋在重试里。
  if (!isProfileMissingError(failure) || !user?.id) return { failure }

  const healError = await ensureProfile(
    supabaseClient,
    user.id,
    nameFromFlowerEmail(user.email)
  )
  if (healError) return { failure }

  return { failure: checkWriteResult(await run(supabaseClient), action) }
}
