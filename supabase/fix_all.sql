-- ⬇️⬇️⬇️ 这是 SQL 脚本，整份复制进 Supabase 控制台 → SQL Editor → Run。
-- 不要复制任何 .js 文件（那是前端代码，粘进 SQL 编辑器会报 syntax error at or near "{"）。
-- ============================================================
-- 此时此地 · 后端一键修复（推荐只跑这一个）
--
-- 为什么要有这份合并脚本：
--   之前分成 fence_migration.sql（围栏字段）和 missing_backend.sql
--   （聊天字段 + 函数 + 权限）两份，用户按报错提示选脚本时选错过一次 ——
--   报「缺少 nut_chat_messages.sent_lat」却跑了 fence_migration.sql，
--   跑完当然还是报同样的错。
--   现在合成一份，不需要判断，跑一次全补齐。
--
-- 覆盖范围：
--   A. nut_chats          补 latitude / longitude / radius / shape / polygon
--                         + is_active 默认值 + 取值约束 + 回填 + 索引
--   B. nut_chat_messages  补 sent_lat / sent_lng / read_by
--   C. 建 toggle_note_like、mark_room_messages_read 两个函数
--   D. 收紧 nut_users 写权限（原来任何人都能改别人的用户名）
--
-- 幂等：可重复执行，不会产生重复列 / 重复函数 / 重复策略。
-- 执行位置：Supabase 控制台 → SQL Editor → 全选粘贴 → Run
-- ============================================================


-- ============================================================
-- A. nut_chats 围栏字段
--    产品定义：创建聊天室 = 创建地理围栏，不在围栏内不可发言。
-- ============================================================

-- A1. 新增字段
--     shape='circle'  用 latitude/longitude + radius
--     shape='polygon' 用 polygon（[[lng,lat],...] 闭合环），
--                     此时 lat/lng 存质心，radius 存外接半径，仅用于粗筛
alter table public.nut_chats
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision,
  add column if not exists radius    integer not null default 300,
  add column if not exists shape     text    not null default 'circle',
  add column if not exists polygon   jsonb;

-- A2. is_active 默认值
--     fetchRooms 只取 is_active = true，若该列默认 false/null，
--     新建的房间会「建了但看不见」。
alter table public.nut_chats alter column is_active set default true;
update public.nut_chats set is_active = true where is_active is null;

-- A3. 取值约束（约束不支持 IF NOT EXISTS，只能先查再加）
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nut_chats'::regclass
       and conname  = 'nut_chats_shape_check'
  ) then
    alter table public.nut_chats
      add constraint nut_chats_shape_check
      check (shape in ('circle', 'polygon'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nut_chats'::regclass
       and conname  = 'nut_chats_radius_range'
  ) then
    alter table public.nut_chats
      -- 上限刻意放宽：多边形存的是「外接半径」（顶点离质心的最远距离），
      -- 手绘时很容易超过 5000。精确范围由前端保证，数据库只挡离谱值。
      add constraint nut_chats_radius_range
      check (radius > 0 and radius <= 50000);
  end if;
end $$;

-- A4. 回填历史数据：已存在的聊天室挂在 nut_areas 下，从所属区域取中心点与半径
update public.nut_chats c
   set latitude  = a.latitude,
       longitude = a.longitude,
       radius    = coalesce(a.radius_meters, 300)
  from public.nut_areas a
 where c.area_id = a.id
   and (c.latitude is null or c.longitude is null);

-- A5. 索引：围栏查询是「经纬度范围 + 时间倒序」
create index if not exists idx_nut_chats_latlng on public.nut_chats (latitude, longitude);


-- ============================================================
-- B. nut_chat_messages 字段
--    sent_lat/sent_lng：发消息时的定位快照，供围栏判定
--    read_by：已读用户 id 数组
--    缺这三列会导致「发消息 100% 失败」。
-- ============================================================
alter table public.nut_chat_messages
  add column if not exists sent_lat double precision,
  add column if not exists sent_lng double precision,
  add column if not exists read_by  uuid[] not null default '{}';


-- ============================================================
-- C. 两个业务函数
--    放在数据库事务里做，避免并发覆盖与客户端伪造。
-- ============================================================

-- C1. 点赞：在事务内切换 liked_by，返回被更新的那一行
--     ⚠️ liked_by 实际是 uuid[]，不是 text[]。早前版本写成 text[]，
--     调用会报 "COALESCE could not convert type text[] to uuid[]"。
--     必须先 DROP：CREATE OR REPLACE 不允许改返回类型（42P13）。
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
  select coalesce(m.liked_by, '{}'::uuid[])
    into v_liked
  from public.nut_messages m
  where m.id = p_message_id
  for update;

  if not found then
    return;
  end if;

  if p_user_id = any(v_liked) then
    v_liked := array_remove(v_liked, p_user_id);
  else
    v_liked := array_append(v_liked, p_user_id);
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

-- C2. 已读：一次性把当前用户追加进未读消息的 read_by
--     只更新「别人发的、且自己还没读过的」，避免把自己发的消息也标已读
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


-- ============================================================
-- D. 收紧 nut_users 写权限：只能改自己
--    实测漏洞：任意登录用户都能改别人的 username。
--    评审链接是公开的，这条必须修。
--    ⚠️ 若你在这张表上加过自定义策略，会被下面的重建覆盖，
--       请先单独查 pg_policies 确认，再手工合并。
-- ============================================================
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


-- ============================================================
-- E. 刷新 PostgREST 的 schema cache（关键，别漏）
--    不刷新的话，即使列已经建好，接口仍会报
--    "Could not find the 'xxx' column of 'xxx' in the schema cache"。
--    用两种形式各发一次：某些连接池（pgbouncer）下 NOTIFY 语句不会被转发。
--    重复发送没有副作用。
-- ============================================================
notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');


-- ============================================================
-- F. 执行后自检（这一节只读，看结果即可）
-- ============================================================

-- F1. 三张表的关键列是否都在
select
  table_name,
  string_agg(column_name, ', ' order by ordinal_position) as columns
from information_schema.columns
where table_schema = 'public'
  and table_name in ('nut_chats', 'nut_chat_messages', 'nut_messages')
group by table_name
order by table_name;

-- F2. 两个函数是否已存在（都应为 t）
select
  exists (select 1 from pg_proc where proname = 'toggle_note_like')        as toggle_note_like,
  exists (select 1 from pg_proc where proname = 'mark_room_messages_read') as mark_room_messages_read;

-- F3. nut_users 当前策略（应为 select_all / insert_self / update_self 三条）
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'nut_users'
order by policyname;

-- F4. 仍未设置围栏的聊天室（应为空；有行则这些房间无人能进）
select c.id, c.name, c.area_id, c.latitude, c.longitude, c.radius, c.shape
from public.nut_chats c
where c.latitude is null or c.longitude is null;
