/**
 * 花名登录测试
 *
 * 运行：npm run test:flower
 *
 * 邮箱是登录身份的来源：必须「合法 ASCII」「同名同邮箱」「不同名不撞车」，
 * 任何一条破了，用户就会登录失败或串号到别人的账号。
 */
import { flowerEmail, hashCode, validateFlowerName, FLOWER_NAME_MAX, nameFromFlowerEmail, isProfileMissingError, ensureProfile } from '../src/lib/flowerAuth.js';
import { AVATAR_EMOJIS, randomAvatar, isEmojiAvatar } from '../src/lib/avatar.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

// 邮箱本地部分允许的字符（GoTrue 校验口径）
const LOCAL_OK = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

console.log('--- 1. 生成的邮箱必须合法（含中文花名）---');
for (const name of ['hermy', '宫赫', '张三丰', 'gonghe1231', 'A-B_C.d', '  hermy  ', '测试 user']) {
  const email = flowerEmail(name);
  ok(`「${name}」→ ${email}`, LOCAL_OK.test(email));
}

console.log('--- 2. 确定性：同名必须得到同一个邮箱 ---');
ok('英文名两次一致', flowerEmail('hermy') === flowerEmail('hermy'));
ok('中文名两次一致', flowerEmail('宫赫') === flowerEmail('宫赫'));
ok('首尾空格不影响', flowerEmail('hermy') === flowerEmail('  hermy  '));

console.log('--- 3. 区分度：不同花名不能撞邮箱 ---');
const names = ['hermy', '宫赫', '张三', 'hermy1', 'hermy-1', 'gonghe'];
const emails = names.map(flowerEmail);
ok('6 个花名互不相同', new Set(emails).size === names.length, emails.join(' | '));
ok('大小写归一', flowerEmail('Hermy') === flowerEmail('hermy'));

console.log('--- 4. hash 基本性质 ---');
ok('hash 非空', hashCode('宫赫').length > 0);
ok('hash 稳定', hashCode('宫赫') === hashCode('宫赫'));
ok('hash 是 ASCII（可进邮箱）', /^[a-z0-9]+$/.test(hashCode('宫赫')));

console.log('--- 5. 花名校验 ---');
ok('空值拦截', validateFlowerName('') !== '');
ok('纯空格拦截', validateFlowerName('   ') !== '');
ok('正常名通过', validateFlowerName('hermy') === '');
ok('超长拦截', validateFlowerName('a'.repeat(FLOWER_NAME_MAX + 1)) !== '');
ok('刚好到上限通过', validateFlowerName('a'.repeat(FLOWER_NAME_MAX)) === '');
ok('null 不崩溃', typeof validateFlowerName(null) === 'string');

// 2026-10-21 线上真实事故：恢复旧会话（localStorage）不经过登录页，
// 档案行缺失时发便签撞外键。恢复路径只能从确定性邮箱反推展示名。
console.log('--- 6. nameFromFlowerEmail：从邮箱反推展示名 ---');
ok('英文名反推', nameFromFlowerEmail('hermy-1n1im9@nut.local') === 'hermy');
ok('纯 slug（中文花名）落回 u', nameFromFlowerEmail('u-gd9c@nut.local') === 'u');
ok('花名含点号保留', nameFromFlowerEmail('a.b_c.d-xy12@nut.local') === 'a.b_c.d');
ok('无 hash 后缀的邮箱取整个本地部分', nameFromFlowerEmail('plainname@nut.local') === 'plainname');
ok('空邮箱落回「用户」', nameFromFlowerEmail('') === '用户');
ok('null 不崩溃', typeof nameFromFlowerEmail(null) === 'string');
ok('老邮箱账号不硬拆，落回「用户」', nameFromFlowerEmail('someone@gmail.com') === '用户');
ok('与 flowerEmail 互逆（英文名）', nameFromFlowerEmail(flowerEmail('gonghe1231')) === 'gonghe1231');

// 发送/发布时遇到外键错误，需要判断是不是「档案缺失」这一类才值得自愈重试，
// 别把 RLS、缺列等真实错误也吞进重试里。
console.log('--- 7. isProfileMissingError：是否值得自愈 ---');
ok('user_id 外键 → 自愈', isProfileMissingError('insert or update on table "nut_chat_messages" violates foreign key constraint "nut_chat_messages_user_id_fkey"'));
ok('chat_id 外键 → 不自愈', !isProfileMissingError('violates foreign key constraint "nut_chat_messages_chat_id_fkey"'));
ok('RLS 错误 → 不自愈', !isProfileMissingError('new row violates row-level security policy'));
ok('缺列错误 → 不自愈', !isProfileMissingError("Could not find the 'sent_lat' column"));
ok('null 不崩溃', typeof isProfileMissingError(null) === 'boolean');



// 2026-10-21 审查发现的回归：ensureProfile 原本无条件 upsert，
// 会把用户在个人页改过的昵称冲掉（每次启动/登录都覆盖一次）。
// 正确语义是「只补不覆盖」：已有档案就什么都不做。
console.log('--- 8. ensureProfile：只补建、不覆盖 ---');

const makeClient = ({ exists, insertOk = true, avatar = '🐿️' }) => {
  const calls = []
  const row = { id: 'u1', avatar_url: avatar }
  return {
    calls,
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: exists ? row : null, error: null }),
              }
            },
            single: async () => (insertOk
              ? { data: { id: 'u1', username: calls[0]?.username }, error: null }
              : { data: null, error: null }),
          }
        },
        // 补随机头像用（档案已存在但 avatar_url 为空时）
        update(payload) {
          calls.push({ __update: payload })
          return {
            eq() {
              return { select: async () => ({ data: [{ id: 'u1' }], error: null }) }
            },
          }
        },
        insert(payload) {
          calls.push(payload)
          return {
            select: () => ({
              single: async () => (insertOk
                ? { data: { id: 'u1', username: payload.username }, error: null }
                : { data: null, error: null }),
            }),
          }
        },
      }
    },
  }
}

const c1 = makeClient({ exists: true })
ok('档案已存在 → 不写库', (await ensureProfile(c1, 'u1', '新名字')) === null);
ok('档案已存在 → 未发起 insert（昵称不被覆盖）', c1.calls.length === 0, `实际调用了 ${c1.calls.length} 次`);

const c2 = makeClient({ exists: false })
ok('档案缺失 → 补建成功', (await ensureProfile(c2, 'u1', '花名A')) === null);
ok('档案缺失 → 确实写入了花名', c2.calls.length === 1 && c2.calls[0].username === '花名A', JSON.stringify(c2.calls));

const c3 = makeClient({ exists: false, insertOk: false })
const r3 = await ensureProfile(c3, 'u1', '花名B')
ok('补建没写进记录 → 必须报错（不能假成功）', typeof r3 === 'string' && r3.includes('初始化用户档案'), String(r3));

// 首次进入分配头像：新建档案必须带上 emoji；老档案已有头像时不能动它
const c4 = makeClient({ exists: false })
await ensureProfile(c4, 'u1', '花名C')
ok('新用户建档 → 带随机 emoji 头像', isEmojiAvatar(c4.calls[0].avatar_url), JSON.stringify(c4.calls[0]));

const c5 = makeClient({ exists: true, avatar: '🦊' })
await ensureProfile(c5, 'u1', '花名D')
ok('已有头像 → 不覆盖（不发起 update/insert）', c5.calls.length === 0, JSON.stringify(c5.calls));

const c6 = makeClient({ exists: true, avatar: null })
await ensureProfile(c6, 'u1', '花名E')
ok('档案存在但头像为空 → 补一个随机头像', c6.calls.length === 1 && isEmojiAvatar(c6.calls[0].__update?.avatar_url), JSON.stringify(c6.calls));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
