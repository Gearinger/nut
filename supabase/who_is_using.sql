-- ⬇️⬇️⬇️ 整份复制进 Supabase 控制台 → SQL Editor → Run
-- 这是 SQL 脚本，不要粘任何 .js 文件。
-- ============================================================
-- 「谁在用我的应用」+「给老用户补 emoji 头像」
--
-- 前 3 段是只读查询，随便跑。
-- 第 4、5 段是写操作，默认整段注释掉了，需要时再解除注释。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 总体规模
--    注册人数取 auth.users（花名登录会给每个人建一个 Auth 账号）；
--    已建档案人数取 public.nut_users（填完花名后才会有这一行）。
--    两者差很多的话，说明有人填了花名但档案没建成。
-- ------------------------------------------------------------
select
  (select count(*) from auth.users)                                          as 注册人数,
  (select count(*) from auth.users where created_at >= now() - interval '1 day')  as 近24小时新增,
  (select count(*) from auth.users where created_at >= now() - interval '7 days') as 近7天新增,
  (select count(*) from public.nut_users)                                    as 已建档案,
  (select count(*) from public.nut_users
     where avatar_url is not null and avatar_url <> '')                      as 有头像;

-- ------------------------------------------------------------
-- 2. 逐个用户 + 活跃度
--    花名优先取 nut_users.username；没有档案时从登录邮箱反推
--    （花名登录把花名编成 <slug>-<hash>@nut.local 当邮箱）。
--    「最后活跃」= 最后一次留言 / 发聊天消息的时间，取不到的退回注册时间。
-- ------------------------------------------------------------
with note_act as (
  select user_id, count(*) as cnt, max(created_at) as last_at
  from public.nut_messages group by user_id
),
talk_act as (
  select user_id, count(*) as cnt, max(created_at) as last_at
  from public.nut_chat_messages group by user_id
),
room_act as (
  select created_by as user_id, count(*) as cnt
  from public.nut_chats group by created_by
)
select
  coalesce(
    n.username,
    regexp_replace(split_part(u.email, '@', 1), '-[0-9a-z]+$', '')
  )                                            as 花名,
  u.created_at                                 as 注册时间,
  u.last_sign_in_at                            as 最后登录,
  coalesce(na.cnt, 0)                          as 留言数,
  coalesce(ta.cnt, 0)                          as 聊天消息数,
  coalesce(ra.cnt, 0)                          as 建房间数,
  greatest(
    coalesce(na.last_at, u.created_at),
    coalesce(ta.last_at, u.created_at)
  )                                            as 最后活跃,
  n.avatar_url                                 as 头像,
  case
    when n.avatar_url is null or n.avatar_url = ''            then '❌ 没头像'
    when n.avatar_url like 'http%' or n.avatar_url like '%/%' then '⚠️ 非emoji'
    else '✅ emoji'
  end                                          as 头像状态,
  u.id                                         as 用户id
from auth.users u
left join public.nut_users n          on n.id = u.id
left join note_act na                 on na.user_id = u.id
left join talk_act ta                 on ta.user_id = u.id
left join room_act ra                 on ra.user_id = u.id
order by u.created_at desc;

-- ------------------------------------------------------------
-- 3. 头像覆盖情况（回答「老用户有没有 emoji」）
-- ------------------------------------------------------------
select
  case
    when avatar_url is null or avatar_url = ''            then '❌ 没头像'
    when avatar_url like 'http%' or avatar_url like '%/%' then '⚠️ 非emoji'
    else '✅ emoji'
  end  as 类别,
  count(*) as 人数
from public.nut_users
group by 1
order by 人数 desc;

-- ------------------------------------------------------------
-- 4.（可选）给所有没头像的人补一个随机 emoji
--    前端其实已经会补：老用户下次打开应用，登录时发现头像为空就随机分配一个
--    （只补空的，绝不覆盖已经选好的）。
--    这条 SQL 是给「想立刻看到效果、不等他下次登录」用的。
--    解除下面整段的注释再跑：
-- ------------------------------------------------------------
-- update public.nut_users n
--    set avatar_url = (array[
--      '🐿️','🦊','🐼','🐨','🦁','🐯',
--      '🐮','🐷','🐸','🐵','🐧','🦉',
--      '🦄','🐝','🦋','🐢','🐙','🐳',
--      '🌵','🍄','🌻','🍀','🌙','⭐️'
--    ])[1 + floor(random() * 24)::int]
--  where n.avatar_url is null or n.avatar_url = '';

-- ------------------------------------------------------------
-- 5.（可选）给某个具体的人指定头像
--    解除注释，把花名和 emoji 换成想要的：
-- ------------------------------------------------------------
-- update public.nut_users set avatar_url = '🦊' where username = '这里填花名';

-- ------------------------------------------------------------
-- 6.（可选）把所有人的 emoji 重新洗一遍
--    慎用：连已经自己挑过头像的人一起改掉。
-- ------------------------------------------------------------
-- update public.nut_users n
--    set avatar_url = (array[
--      '🐿️','🦊','🐼','🐨','🦁','🐯',
--      '🐮','🐷','🐸','🐵','🐧','🦉',
--      '🦄','🐝','🦋','🐢','🐙','🐳',
--      '🌵','🍄','🌻','🍀','🌙','⭐️'
--    ])[1 + floor(random() * 24)::int]
--  where n.avatar_url is null
--     or n.avatar_url = ''
--     or n.avatar_url not like 'http%';
