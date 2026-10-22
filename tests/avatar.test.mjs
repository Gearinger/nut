/**
 * emoji 头像测试
 *
 * 运行：npm run test:avatar
 */
import { AVATAR_EMOJIS, randomAvatar, isEmojiAvatar } from '../src/lib/avatar.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

console.log('--- 1. 随机头像必须落在候选集内 ---');
ok('候选集非空且不少于 12 个', AVATAR_EMOJIS.length >= 12, `实际 ${AVATAR_EMOJIS.length}`);
ok('候选集无重复', new Set(AVATAR_EMOJIS).size === AVATAR_EMOJIS.length);
let allIn = true, seen = new Set();
for (let i = 0; i < 300; i++) {
  const a = randomAvatar();
  if (!AVATAR_EMOJIS.includes(a)) allIn = false;
  seen.add(a);
}
ok('300 次随机全部合法', allIn);
ok('随机有分散度（不是永远同一个）', seen.size > 5, `只出现了 ${seen.size} 种`);

console.log('--- 2. isEmojiAvatar：别把图片 URL 当 emoji 渲染 ---');
ok('集合内 emoji 识别为头像', isEmojiAvatar('🐿️'));
ok('null 不是头像', !isEmojiAvatar(null));
ok('空串不是头像', !isEmojiAvatar(''));
ok('undefined 不是头像', !isEmojiAvatar(undefined));
ok('http 图片链接不算 emoji 头像', !isEmojiAvatar('https://cdn.example.com/a.png'));
ok('普通文字不算头像', !isEmojiAvatar('hermy'));
ok('数字不算头像', !isEmojiAvatar(123));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
