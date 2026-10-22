/**
 * emoji 头像。
 *
 * 产品选择：不做图片上传，用 emoji 当头像。
 *   1) 没有存储、审核、外链失效这些成本，内部演示 / 比赛场景够用；
 *   2) 花名登录没有邮箱，拿不到 Gravatar 这类默认图；
 *   3) emoji 在地图气泡、消息列表这种小尺寸下辨识度反而比照片高。
 *
 * 存哪里：复用 nut_users.avatar_url 这一列（原本就没用上，恒为 null），
 * 直接存 emoji 字符本身，不新增列、不做迁移。
 */

/**
 * 可选 emoji。刻意选「色块分明、小尺寸可辨」的，
 * 避免一堆黄色脸emoji在小圆头像里糊成一团。
 */
export const AVATAR_EMOJIS = [
  '🐿️', '🦊', '🐼', '🐨', '🦁', '🐯',
  '🐮', '🐷', '🐸', '🐵', '🐧', '🦉',
  '🦄', '🐝', '🦋', '🐢', '🐙', '🐳',
  '🌵', '🍄', '🌻', '🍀', '🌙', '⭐️',
]

/** 随机一个头像（首次进入时分配） */
export function randomAvatar() {
  return AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)]
}

/**
 * 判断某个值是不是我们自己的 emoji 头像。
 *
 * 为什么要判断：avatar_url 这一列历史上是给图片 URL 留的（虽然从没写入过），
 * 不能简单「有值就当 emoji 渲染」，否则一个 http 链接会被当成文字显示出来。
 */
export function isEmojiAvatar(value) {
  return typeof value === 'string' && AVATAR_EMOJIS.includes(value)
}
