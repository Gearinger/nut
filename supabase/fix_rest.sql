-- ⬇️⬇️⬇️ 这是 SQL 脚本，整份复制进 Supabase 控制台 → SQL Editor → Run。
-- 不要复制任何 .js 文件（那是前端代码，粘进 SQL 编辑器会报 syntax error at or near "{"）。
-- ============================================================
-- 剩余待跑的两项（fix_all.sql 的 C1 + D 段，单独抽出来方便只补这两项）
--
--   ① 点赞函数 toggle_note_like 类型写错了：liked_by 实际是 uuid[]，
--      旧版本按 text[] 写，调用报 "COALESCE could not convert type text[] to uuid[]"，
--      表现为点了赞没反应。
--   ② nut_users 的 UPDATE 策略不限本人：实测任意登录用户都能改别人的用户名，
--      评审链接是公开的，必须堵。
--   ③ nut_chats 的 UPDATE 策略不限创建者：实测任意登录用户都能把别人的聊天室
--      改成关闭（is_active=false）。准备加「关闭聊天室」功能，权限必须先收紧，
--      否则就等于谁都能关掉别人的房间。
--
-- 幂等，可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- ① 点赞：在事务内切换 liked_by，返回被更新的那一行
--    必须先 DROP：PostgreSQL 不允许用 CREATE OR REPLACE 改返回类型
--    （旧版是 text[]，新版是 uuid[]，直接替换会报 42P13
--     "cannot change return type of existing function"）。
-- ------------------------------------------------------------
drop function if exists public.toggle_note_like(uuid, uuid);

create or replace function public.toggle_note_like(p_message_id uuid, p_user_id uuid)
returns table (id uuid, like_counts integer, liked_by uuid[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liked  uuid[];
  v_result record;
begin
  -- for update 锁住这一行，避免并发点赞互相覆盖
  select coalesce(m.liked_by, '{}'::uuid[])
    into v_liked
  from public.nut_messages m
  where m.id = p_message_id
  for update;

  if not found then
    return;  -- 便签不存在，静默返回（前端会回滚乐观更新）
  end if;

  if p_user_id = any(v_liked) then
    v_liked := array_remove(v_liked, p_user_id);   -- 已赞过 → 取消
  else
    v_liked := array_append(v_liked, p_user_id);   -- 没赞过 → 加上
  end if;

  update public.nut_messages m
     set liked_by    = v_liked,
         like_counts = coalesce(array_length(v_liked, 1), 0)
   where m.id = p_message_id
  returning m.id, m.like_counts, m.liked_by into v_result;

  id := v_result.id;
  like_counts := v_result.like_counts;
  liked_by := v_result.liked_by;
  return next;
end;
$$;

-- ------------------------------------------------------------
-- ② 收紧 nut_users 写权限：只能改自己
--    做法是先清掉这张表上的旧策略，再按最小权限重建。
--    ⚠️ 若你在这张表上加过自定义策略，会被下面覆盖，
--       请先查 pg_policies 确认，再手工合并。
-- ------------------------------------------------------------
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'nut_users'
  loop
    execute format('drop policy %I on public.nut_users', p.policyname);
  end loop;
end $$;

create policy nut_users_select_all on public.nut_users
  for select using (true);

create policy nut_users_insert_self on public.nut_users
  for insert with check (auth.uid() = id);

create policy nut_users_update_self on public.nut_users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ------------------------------------------------------------
-- ③ 收紧 nut_chats 写权限：只有创建者能改自己的聊天室
--    实测：用 A 账号的 token 去 PATCH B 账号建的房间，返回 200 改成功了。
--    现在要加「关闭聊天室」功能，不收紧就等于谁都能关掉别人的房间。
--
--    注意两点：
--    a) 只删除 UPDATE / ALL 策略，select 与 insert 保持原样，
--       否则建房间、首页列表会一起坏掉；
--    b) 如果这张表原本没开 RLS（很可能，所以才会被越权改），
--       打开 RLS 后没有策略会导致读写全部失效，所以下面补了兜底策略。
-- ------------------------------------------------------------
alter table public.nut_chats enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'nut_chats'
              and cmd in ('UPDATE', '*')   -- '*' 是 for all 策略，一并清掉
  loop
    execute format('drop policy %I on public.nut_chats', p.policyname);
  end loop;
end $$;

do $$
begin
  -- 兜底：原本没有 select 策略的话，开 RLS 后首页连房间列表都读不出来
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'nut_chats' and cmd = 'SELECT'
  ) then
    execute 'create policy nut_chats_select_all on public.nut_chats for select using (true)';
  end if;

  -- 兜底：建房间仍然允许（created_by 必须填自己）
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'nut_chats' and cmd = 'INSERT'
  ) then
    execute 'create policy nut_chats_insert_self on public.nut_chats
             for insert with check (created_by = auth.uid())';
  end if;
end $$;

-- 只有创建者能改，且改完 created_by 还得是自己（防把房间转让给别人绕过）
create policy nut_chats_update_owner on public.nut_chats
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());

-- 不建 delete 策略 = 谁都删不掉，聊天记录不会因为误删丢失；
-- 「关闭」走 is_active=false 软删，创建者随时能重新打开。

-- ------------------------------------------------------------
-- 刷新 PostgREST 的 schema cache（不刷可能还走旧的函数签名）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

-- ------------------------------------------------------------
-- 自检
--   ① 函数返回值应含 uuid[]（而不是 text[]）
--   ② nut_users 策略应恰好三条：insert_self / select_all / update_self
--   ③ nut_chats 应恰好三条：select_all / insert_self / update_owner，
--      且 update_owner 的 qual 里带 created_by = auth.uid()
-- ------------------------------------------------------------
select p.proname, pg_get_function_result(p.oid) as returns
from pg_proc p
where p.proname = 'toggle_note_like';

select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'nut_users'
order by policyname;

select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'nut_chats'
order by policyname;

-- 有没有建过但 created_by 为空的房间：这类房间收紧后创建者也改不动
-- （不影响使用，只是关不掉；要清理就把 created_by 补上）
select count(*) as rooms_without_owner
from public.nut_chats
where created_by is null;
