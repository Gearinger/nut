/**
 * 聊天室「关闭 / 重新打开」测试
 *
 * 运行：npm run test:rooms
 *
 * 重点测两件容易出错的事：
 *   1) 静默失败要能被抓出来（RLS 拦截时 error 为 null、data 为空）；
 *   2) 确认文案要区分「关」和「重新打开」，否则用户会以为要删数据。
 */
import { setRoomActive, roomToggleConfirm } from '../src/lib/rooms.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' -> ' + extra : ''}`); }
};

const ROOM = { id: 'r1', name: '堵车吐槽室', is_active: false };

/** 造一个最小 supabase client：只实现 rooms.js 用到的链式调用 */
const fakeClient = (result) => ({
  from: () => ({
    update: () => ({
      eq: () => ({
        select: () => ({
          single: async () => result,
        }),
      }),
    }),
  }),
});

// 1. 正常关闭
{
  const { failure, room } = await setRoomActive(
    fakeClient({ data: ROOM, error: null }), 'r1', false
  );
  ok('关闭成功时 failure 为 null', failure === null, String(failure));
  ok('关闭成功时返回房间', room && room.is_active === false);
}

// 2. 正常重新打开
{
  const { failure, room } = await setRoomActive(
    fakeClient({ data: { ...ROOM, is_active: true }, error: null }), 'r1', true
  );
  ok('重新打开成功时 failure 为 null', failure === null, String(failure));
  ok('重新打开返回 is_active=true', room && room.is_active === true);
}

// 3. 静默失败：被 RLS 拦下时 PostgREST 不报错，data 却是空的
{
  const { failure, room } = await setRoomActive(
    fakeClient({ data: null, error: null }), 'r1', false
  );
  ok('静默 0 行必须报失败', typeof failure === 'string' && failure.length > 0);
  ok('静默失败文案带「关闭」', /关闭失败/.test(failure || ''), String(failure));
  ok('静默失败不返回房间', room === null);
}

// 4. 空数组同样算失败（不带 .single() 时 PostgREST 返回 []）
{
  const { failure } = await setRoomActive(
    fakeClient({ data: [], error: null }), 'r1', true
  );
  ok('空数组必须报失败', /重新打开失败/.test(failure || ''), String(failure));
}

// 5. 真报错要走错误翻译
{
  const { failure } = await setRoomActive(
    fakeClient({ data: null, error: { message: 'violates row-level security policy' } }),
    'r1', false
  );
  ok('RLS 报错翻译成权限说明', /RLS|权限/.test(failure || ''), String(failure));
}

// 6. 确认文案
{
  const close = roomToggleConfirm('堵车吐槽室', false);
  const reopen = roomToggleConfirm('堵车吐槽室', true);
  ok('关闭文案说明记录保留', /保留/.test(close), close);
  ok('关闭文案带房间名', /堵车吐槽室/.test(close), close);
  ok('重开文案与关闭文案不同', close !== reopen);
  ok('重开文案说明会重新出现', /重新出现/.test(reopen), reopen);
}

console.log(`\n聊天室开关测试：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
