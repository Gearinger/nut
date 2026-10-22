-- ============================================================
-- 围栏字段迁移（nut_chats）
--
-- ⚠️ 只补围栏字段。若你不确定该跑哪份，请直接跑 supabase/fix_all.sql ——
--    它包含本文件的全部内容，另外还补聊天字段、两个函数和权限，
--    幂等且自带自检。分成两份脚本曾导致用户选错、跑完仍报同样的错。
--
-- 产品定义：创建聊天室 = 创建地理围栏，不在围栏内不可发言。
-- 之前 nut_chats 只有 id / created_by / area_id / name / created_at，
-- 完全没有地理字段，围栏无从谈起。
--
-- 本脚本幂等，可重复执行。
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴运行
-- ============================================================

-- ------------------------------------------------------------
-- 1. 新增围栏字段
--    shape='circle'  用 latitude/longitude + radius
--    shape='polygon' 用 polygon（[[lng,lat],...] 闭合环），
--                    此时 lat/lng 存质心，radius 存外接半径，仅用于粗筛
-- ------------------------------------------------------------
alter table public.nut_chats
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision,
  add column if not exists radius    integer not null default 300,
  add column if not exists shape     text    not null default 'circle',
  add column if not exists polygon   jsonb;

-- ------------------------------------------------------------
-- 1b. 顺手修一个会让房间「建了但看不见」的默认值
--     fetchRooms 只取 is_active = true，若该列默认 false/null，
--     新建的房间会静默消失。
-- ------------------------------------------------------------
alter table public.nut_chats alter column is_active set default true;
update public.nut_chats set is_active = true where is_active is null;

-- ------------------------------------------------------------
-- 2. 取值约束（单独加，避免 IF NOT EXISTS 不支持约束的问题）
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 3. 回填历史数据
--    已存在的聊天室都挂在 nut_areas 下，从所属区域取中心点与半径。
--    区域本身有 latitude / longitude / radius_meters。
-- ------------------------------------------------------------
update public.nut_chats c
   set latitude  = a.latitude,
       longitude = a.longitude,
       radius    = coalesce(a.radius_meters, 300)
  from public.nut_areas a
 where c.area_id = a.id
   and (c.latitude is null or c.longitude is null);

-- ------------------------------------------------------------
-- 4. 索引：围栏查询是「经纬度范围 + 时间倒序」
-- ------------------------------------------------------------
create index if not exists idx_nut_chats_latlng on public.nut_chats (latitude, longitude);

-- ------------------------------------------------------------
-- 5. 自检：列出仍未设置围栏的聊天室（应为空）
--    若这里还有行，说明 area_id 指向的区域不存在，需要人工补坐标，
--    否则这些房间对所有人都是「超出围栏」，无法进入。
-- ------------------------------------------------------------
select
  c.id,
  c.name,
  c.area_id,
  c.latitude,
  c.longitude,
  c.radius,
  c.shape
from public.nut_chats c
where c.latitude is null or c.longitude is null;

-- ------------------------------------------------------------
-- 6. 刷新 PostgREST 的 schema cache（关键，别漏）
--    不刷新的话，即使列已经建好，接口仍会报：
--    "Could not find the 'latitude' column of 'nut_chats'
--     in the schema cache"
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- 双保险：某些连接池（pgbouncer）下 NOTIFY 语句不会被转发，
-- 用函数形式再发一次。重复发送没有副作用。
select pg_notify('pgrst', 'reload schema');

-- ------------------------------------------------------------
-- 7. 执行后自检：确认列已生效（应看到 11 个字段）
-- ------------------------------------------------------------
select string_agg(column_name, ', ' order by ordinal_position) as nut_chats_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'nut_chats';
