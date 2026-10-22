/**
 * 数据库报错翻译测试
 *
 * 运行：npm run test:dberror
 *
 * 这类错误的价值在于「告诉用户下一步做什么」。如果翻译丢字或匹配不到，
 * 用户看到的就只剩一句看不懂的 PostgREST 原文。
 */
import { describeDbError, checkWriteResult } from '../src/lib/dbError.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};

console.log('--- 1. schema cache 缺列：本次线上真实报错 ---');
const schemaMiss = describeDbError({
  message: "Could not find the 'latitude' column of 'nut_chats' in the schema cache",
});
ok('识别出缺列', schemaMiss.includes('数据库缺少字段'), schemaMiss);
ok('带出字段名与表名', schemaMiss.includes('nut_chats.latitude'), schemaMiss);
ok('指向一键修复脚本', schemaMiss.includes('fix_all.sql'), schemaMiss);
ok('保留原始信息', schemaMiss.includes('in the schema cache'), schemaMiss);

// 2026-10-21 线上真实事故：提示一度统一指向 fence_migration.sql，
// 用户照着跑完仍然报 sent_lat 缺失——该列其实在另一份脚本里。
// 现在所有缺列/缺函数都统一指向 fix_all.sql，杜绝再选错。
console.log('--- 1b. 缺列提示必须指向 fix_all.sql（本次真实报错）---');
const msgMiss = describeDbError({
  message: "Could not find the 'sent_lat' column of 'nut_chat_messages' in the schema cache",
});
ok('带出字段与表名', msgMiss.includes('nut_chat_messages.sent_lat'), msgMiss);
ok('指向 fix_all.sql', msgMiss.includes('fix_all.sql'), msgMiss);
ok('不再误指 fence_migration.sql', !msgMiss.includes('fence_migration.sql'), msgMiss);

const noteMiss = describeDbError({
  message: "Could not find the 'like_counts' column of 'nut_messages' in the schema cache",
});
ok('nut_messages 同样指向 fix_all.sql', noteMiss.includes('fix_all.sql'), noteMiss);

console.log('--- 2. 其他常见数据库错误 ---');
const rls = describeDbError({ message: 'new row violates row-level security policy' });
ok('RLS 拒绝可识别', rls.includes('RLS'), rls);

const fk = describeDbError({ message: 'insert or update on table "nut_messages" violates foreign key constraint' });
ok('外键约束可识别', fk.includes('nut_users'), fk);

const dup = describeDbError({ message: 'duplicate key value violates unique constraint' });
ok('唯一键冲突可识别', dup.includes('同名'), dup);

console.log('--- 3. 兜底：不认识的错误必须原样返回，不能吞掉 ---');
const weird = describeDbError({ message: 'connection refused' });
ok('未知错误原样透传', weird === 'connection refused', weird);
ok('空错误不崩溃', typeof describeDbError(null) === 'string');
ok('无 message 字段不崩溃', typeof describeDbError({}) === 'string');

console.log('--- 3b. RPC 函数缺失（点赞 / 已读标记会撞到）---');
const fnMiss = describeDbError({
  message: 'Could not find the function public.toggle_note_like(p_message_id, p_user_id) in the schema cache',
});
ok('识别出缺函数', fnMiss.includes('数据库缺少函数'), fnMiss);
ok('带出函数名', fnMiss.includes('toggle_note_like'), fnMiss);
ok('指向补齐脚本', fnMiss.includes('fix_all.sql'), fnMiss);

console.log('--- 4. checkWriteResult：写操作「假成功」防线 ---');
ok('写入成功返回 null', checkWriteResult({ data: { id: 1 }, error: null }, '保存') === null);
ok('有 error 时返回文案', checkWriteResult({ data: null, error: { message: 'boom' } }, '发送').includes('发送失败'));
ok('无 error 但也没写进数据 → 必须报错', checkWriteResult({ data: null, error: null }, '发布').includes('没有写入任何记录'));
ok('data 为 undefined 同样拦截', checkWriteResult({ error: null }, '发布') !== null);
ok('data 为空数组不算成功（未取回行）', checkWriteResult({ data: [], error: null }, '发布') === null ? false : true);
ok('自定义动作名生效', checkWriteResult({ data: null, error: null }, '点赞').startsWith('点赞失败'));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
