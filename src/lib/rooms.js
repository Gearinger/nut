/**
 * 聊天室的「关闭 / 重新打开」（软删）。
 *
 * 为什么是软删而不是真删：
 *   聊天室是多人共有的，一个人删掉会把所有人的历史消息一起抹掉，
 *   而且围栏里的人还看得见入口却进不去，比「消失」更困惑。
 *   所以只把 is_active 置 false：房间从首页列表和地图上消失，
 *   消息一条不少，创建者随时能重新打开。
 *
 * 前置条件（重要）：
 *   数据库必须跑过 supabase/fix_rest.sql 的第③项——nut_chats 的 UPDATE
 *   策略收紧到「只有创建者能改」。没收紧之前，任意登录用户都能改别人的房间，
 *   这个功能上线等于把「关别人房间」的按钮递给所有人。
 */

import { checkWriteResult } from './dbError.js'

/**
 * @param {object} client  supabase client
 * @param {string} roomId  聊天室 id
 * @param {boolean} isActive true = 重新打开，false = 关闭
 * @returns {Promise<{failure: string|null, room: object|null}>}
 *          failure 为 null 才是真的改成功了
 */
export async function setRoomActive(client, roomId, isActive) {
  const result = await client
    .from('nut_chats')
    .update({ is_active: isActive })
    .eq('id', roomId)
    .select('id, name, is_active')
    .single()

  // 同样不能只看 error：RLS 拦截时 PostgREST 会「静默 0 行」，
  // 只看 error 会把「没关掉」显示成「已关闭」。
  let failure = checkWriteResult(result, isActive ? '重新打开' : '关闭')

  // 没报 error 却一行没写 = 被 RLS 策略挡了。这时光说「请稍后重试」没用，
  // 重试一万次也一样：必须把人引到那段能真正修好它的脚本上。
  // （教训：错误提示指错脚本比不提示更糟，用户会以为脚本没生效反复重跑。）
  if (failure && !result?.error) {
    failure +=
      '\n\n多半是 nut_chats 的 UPDATE 策略还没放行。' +
      '请在 Supabase 控制台执行 supabase/fix_rest.sql（第③项：把 UPDATE 收紧到创建者），再重试。'
  }
  return { failure, room: result.data || null }
}

/** 二次确认的文案，两个入口保持一致 */
export function roomToggleConfirm(name, nextActive) {
  return nextActive
    ? `重新打开「${name}」？\n聊天记录都在，房间会重新出现在首页和地图上。`
    : `关闭「${name}」？\n房间会从首页和地图消失，但聊天记录全部保留，你可以随时重新打开。`
}
