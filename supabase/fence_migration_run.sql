-- 围栏迁移 · 精简执行版（无注释，整段复制直接跑）
-- 幂等，可重复执行。完整注释版见 fence_migration.sql

alter table public.nut_chats
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision,
  add column if not exists radius    integer not null default 300,
  add column if not exists shape     text    not null default 'circle',
  add column if not exists polygon   jsonb;

alter table public.nut_chats alter column is_active set default true;
update public.nut_chats set is_active = true where is_active is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nut_chats'::regclass
       and conname  = 'nut_chats_shape_check'
  ) then
    alter table public.nut_chats
      add constraint nut_chats_shape_check check (shape in ('circle', 'polygon'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.nut_chats'::regclass
       and conname  = 'nut_chats_radius_range'
  ) then
    alter table public.nut_chats
      add constraint nut_chats_radius_range check (radius > 0 and radius <= 50000);
  end if;
end $$;

update public.nut_chats c
   set latitude  = a.latitude,
       longitude = a.longitude,
       radius    = coalesce(a.radius_meters, 300)
  from public.nut_areas a
 where c.area_id = a.id
   and (c.latitude is null or c.longitude is null);

create index if not exists idx_nut_chats_latlng on public.nut_chats (latitude, longitude);

notify pgrst, 'reload schema';
select pg_notify('pgrst', 'reload schema');

select string_agg(column_name, ', ' order by ordinal_position) as nut_chats_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'nut_chats';
