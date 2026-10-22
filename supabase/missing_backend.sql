-- ============================================================
-- 补齐后端缺失（列 / 函数 / 权限）
--
-- 扫描前端所有写操作时发现，代码依赖的下列东西在数据库里并不存在：
--   1. nut_chat_messages 缺 sent_lat / sent_lng / read_by  → 发消息必失败
--   2. 缺 toggle_note_like 函数                            → 点赞永远是空转
--   3. 缺 mark_room_messages_read 函数                     → 已读标记永远失败
--   4. nut_users 的 UPDATE 策略不限制本人                  → 任何人可改任意人的用户名
--
-- ⚠️ 若你不确定该跑哪份，请直接跑 supabase/fix_all.sql ——
--    它包含本文件的全部内容，另外还补围栏字段，幂等且自带自检。
--    分成两份脚本曾导致用户选错、跑完仍报同样的错。
--
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴运行（幂等，可重复执行）
-- ============================================================

-- ------------------------------------------------------------
-- 0. 先看现状（可选，只读）
-- ------------------------------------------------------------
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies where schemaname='public' and tablename in ('nut_users','nut_chat_messages');

-- ------------------------------------------------------------
-- 1. 补消息表的围栏快照与已读字段
--    sent_lat/sent_lng：发消息时的定位快照，供围栏触发器判定
--    read_by：已读用户 id 数组
-- ------------------------------------------------------------
alter table public.nut_chat_messages
  add column if not exists sent_lat double precision,
  add column if not exists sent_lng double precision,
  add column if not exists read_by  uuid[] not null default '{}';

-- ------------------------------------------------------------
-- 2. 点赞：在数据库事务内切换，避免并发覆盖与客户端伪造
--    返回被更新的那一行（id / like_counts / liked_by）
-- ------------------------------------------------------------
create or replace function public.toggle_note_like(p_message_id uuid, p_user_id uuid)
returns table (id uuid, like_counts integer, liked_by text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liked  text[];
  v_result record;
begin
  select array(select unnest(coalesce(m.liked_by, '{}'::text[])))
    into v_liked
  from public.nut_messages m
  where m.id = p_message_id
  for update;

  if not found then
    return;
  end if;

  if p_user_id::text = any(v_liked) then
    v_liked := array_remove(v_liked, p_user_id::text);
  else
    v_liked := array_append(v_liked, p_user_id::text);
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
-- 3. 已读：一次性把当前用户追加进未读消息的 read_by
--    返回被更新的消息行，供前端本地合并，省一次全量重拉
-- ------------------------------------------------------------
create or replace function public.mark_room_messages_read(p_chat_id uuid, p_user_id uuid)
returns table (id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.nut_chat_messages m
     set read_by = array_append(coalesce(m.read_by, '{}'::uuid[]), p_user_id)
   where m.chat_id = p_chat_id
     and m.user_id is distinct from p_user_id
     and not (p_user_id = any(coalesce(m.read_by, '{}'::uuid[])))
  returning m.id;
end;
$$;

-- ------------------------------------------------------------
-- 4. 收紧 nut_users 的写权限：只能改自己
--    实测：任意登录用户都能改别人的 username，这是必须修的漏洞。
--    做法是先清掉这张表上的旧策略，再按最小权限重建。
--    ⚠️ 若你在这张表上加过自定义策略，请先跑第 0 节确认，再手工合并。
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
-- 5. 刷新 PostgREST 的 schema cache（别漏）
-- ------------------------------------------------------------
notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

-- ------------------------------------------------------------
-- 6. 执行后自检
--    ① 应看到 sent_lat / sent_lng / read_by
--    ② 两个函数都应返回 exists = t
-- ------------------------------------------------------------
select string_agg(column_name, ', ' order by ordinal_position) as nut_chat_messages_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'nut_chat_messages';

select
  exists (select 1 from pg_proc where proname = 'toggle_note_like')        as toggle_note_like,
  exists (select 1 from pg_proc where proname = 'mark_room_messages_read') as mark_room_messages_read;
