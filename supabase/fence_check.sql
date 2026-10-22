-- ============================================================
-- 围栏字段只读诊断（不改动任何数据，可随便跑）
--
-- 用途：确认 nut_chats 是否已执行过 fence_migration.sql
-- 执行位置：Supabase 控制台 → SQL Editor → 粘贴运行
-- ============================================================

-- 1. nut_chats 当前有哪些列
--    正常应包含：id, created_by, area_id, name, created_at, is_active,
--                latitude, longitude, radius, shape, polygon
select ordinal_position, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'nut_chats'
order by ordinal_position;

-- 2. 还缺哪些围栏字段（应为空；非空就说明迁移没跑成功）
select unnest(array['latitude', 'longitude', 'radius', 'shape', 'polygon']) as 缺失字段
except
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'nut_chats';

-- 3. 已存在的房间里，有多少个没有围栏几何
--    迁移脚本会从 nut_areas 回填，正常应为 0
select
  count(*) as 房间总数,
  count(*) filter (where latitude is null or longitude is null) as 无围栏房间数
from public.nut_chats;
