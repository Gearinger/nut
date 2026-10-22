-- ⬇️⬇️⬇️ 整份复制进 Supabase 控制台 → SQL Editor → Run（一次跑完，别分段）
-- 这是 SQL 脚本，不要粘任何 .js 文件。
-- ============================================================
-- 演示用 mock 数据：深圳 / 上海 / 北京 三座城市各一套
--   12 个假用户 + 48 条留言 + 18 个聊天室 + 120 条聊天消息
--
-- 为什么铺三座城市：留言是按「用户真实定位 ±0.05 度（约 5 公里）」取的
-- （见 useStore.fetchNotes），不是按地图视野。只铺一个城市的话，
-- 不在这个城市打开应用的人一条都看不到。
--
-- 坐标改哪里：下面 mock_city 那三行，换成你演示时所在的位置即可。
-- 前置：先跑过 supabase/fix_all.sql（补字段）和 fix_rest.sql（补函数与权限）。
-- 幂等：可重复跑；清理由文件末尾的注释段落提供。
-- ============================================================

-- ------------------------------------------------------------
-- 0. mock 用户（12 个）
--    nut_users.id 若存在指向 auth.users 的外键，这里的 insert 会失败，
--    所以用 exception 兜住并打印提示，脚本继续往下跑（改复用现有用户）。
-- ------------------------------------------------------------
do $$
declare
  v_names text[] := array[
    '夜班车司机', '人民广场鸽', '堵车诗人', '便利店夜班',
    '梧桐树下', '地铁2号线', '外卖小哥A', '摆摊的阿姐',
    '加班到十点', '来看演唱会的', '遛狗的老张', '实习生小鹿'
  ];
  v_emojis text[] := array[
    '🦉', '🐧', '🦊', '🌙',
    '🍀', '🐙', '🐝', '🌻',
    '🐿️', '🐳', '🐮', '🦄'
  ];
  i int;
begin
  for i in 1..array_length(v_names, 1) loop
    if not exists (select 1 from public.nut_users where username = v_names[i]) then
      begin
        insert into public.nut_users (id, username, avatar_url)
        values (gen_random_uuid(), v_names[i], v_emojis[i]);
      exception when others then
        raise notice 'mock 用户「%」没建成（%），后面会复用现有用户', v_names[i], sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- 作者池：优先用刚建的 mock 用户；一个都没建成则退回现有全部用户
create temp table mock_author as
  select id, row_number() over (order by id) - 1 as rn
  from public.nut_users
  where username = any (array[
    '夜班车司机', '人民广场鸽', '堵车诗人', '便利店夜班',
    '梧桐树下', '地铁2号线', '外卖小哥A', '摆摊的阿姐',
    '加班到十点', '来看演唱会的', '遛狗的老张', '实习生小鹿'
  ]);

insert into mock_author
  select id, row_number() over (order by id) - 1
  from public.nut_users
  where not exists (select 1 from mock_author);

-- ------------------------------------------------------------
-- 1. 三座城市（想换城市就改这三行的坐标和名字）
--
--    ⚠️ 坐标系：这里必须是 WGS-84。
--    浏览器定位返回 WGS-84，留言和围栏判定的经纬度也按 WGS-84 存，
--    而平时查到的「腾讯/高德坐标」是 GCJ-02，两者差 300~800 米 ——
--    直接填 GCJ-02 的话，人站在市中心也会被判成「不在围栏内」。
--    下面三行已用 src/lib/coords.js 的 gcj02ToWgs84 换算过。
-- ------------------------------------------------------------
create temp table mock_city (rn int, name text, lat double precision, lng double precision);
insert into mock_city values
  (0, '深圳', 22.543518, 113.941725),   -- 南山科技园一带
  (1, '上海', 31.232329, 121.469162),   -- 人民广场，也是应用默认视野中心
  (2, '北京', 39.907452, 116.453031);   -- 国贸一带

-- ------------------------------------------------------------
-- 2. 区域：留言和聊天室都要挂 area_id，每座城市建一个
-- ------------------------------------------------------------
insert into public.nut_areas (name, latitude, longitude, radius_meters)
select c.name || '·演示区域', c.lat, c.lng, 2000
from mock_city c
where not exists (
  select 1 from public.nut_areas a
  where a.latitude  between c.lat - 0.01 and c.lat + 0.01
    and a.longitude between c.lng - 0.01 and c.lng + 0.01
);

-- 每座城市只取一个 area，避免附近已有多个区域时留言被重复插入
create temp table mock_area as
select distinct on (c.name) c.name as city, a.id
from mock_city c
join public.nut_areas a
  on a.latitude  between c.lat - 0.01 and c.lat + 0.01
 and a.longitude between c.lng - 0.01 and c.lng + 0.01
order by c.name, a.id;

-- ------------------------------------------------------------
-- 3. 留言（每城 16 条，共 48 条）
--    坐标按「场景簇」散在市中心周围 1~2 公里：堵车一簇、演唱会一簇、
--    市集一簇……地图上会形成几团热闹的点，而不是均匀撒开的一盘沙。
--    内容刻意不带城市地名，三城共用一套文案。
-- ------------------------------------------------------------
with note (seq, body, lat_off, lng_off, mins_ago, ttl) as (
  values
    (1,  '这条路又堵死了，前面那辆车的刹车灯闪了一路，我都数到 200 了。',   0.0080, -0.0050,  28, 'permanent'),
    (2,  '谁在广场喂鸽子？我这有半袋面包，一个人吃不完。',                 0.0012,  0.0008,  52, '7d'),
    (3,  '刚从演唱会出来，耳朵还在嗡，有人一起去吃夜宵吗？',               0.0042,  0.0061,  16, '24h'),
    (4,  '市集那个卖手冲的摊子还在吗？我十分钟后到。',                    -0.0031,  0.0083,  41, '24h'),
    (5,  '路口的红灯坏了，交警在手动指挥，注意避让。',                     0.0018, -0.0087,  73, '7d'),
    (6,  '这栋楼下有只猫，常驻，不怕人，可以摸。',                        -0.0042, -0.0036, 120, 'permanent'),
    (7,  '雨停了，地上全是水洼，踩一脚凉的。',                            -0.0068,  0.0022,  95, '7d'),
    (8,  '第一次来这儿，站在路口不知道往哪走，有没有本地人带路？',           0.0006, -0.0011,  34, '24h'),
    (9,  '便利店关东煮卖完了，心碎。',                                  -0.0055, -0.0041,  61, '7d'),
    (10, '有人捡到一个蓝色耳机吗？大概十分钟前在这附近掉的。',               0.0033,  0.0029,  11, '24h'),
    (11, '凌晨的地铁站只有我和打扫的阿姨，两个人各自安静。',                 -0.0021, -0.0092, 210, 'permanent'),
    (12, '外卖超时 40 分钟，但骑手说电动车半路没电了，算了不投诉了。',          0.0067,  0.0044,  88, '7d'),
    (13, '这边有个街头歌手，唱得挺好，围了一圈人。',                       -0.0019,  0.0072,  23, '24h'),
    (14, '临时市集明天还有吗？今天没逛够。',                             -0.0038,  0.0088,  47, '7d'),
    (15, '楼下在拍戏，封了半条路，绕行。',                               0.0091, -0.0027, 150, '7d'),
    (16, '今天的云特别好看，抬头。',                                    0.0024, -0.0048,   7, 'permanent')
)
insert into public.nut_messages
  (user_id, area_id, latitude, longitude, content, expires_at, created_at, like_counts, liked_by)
select
  a.id,
  ar.id,
  c.lat + n.lat_off,
  c.lng + n.lng_off,
  n.body,
  case n.ttl
    when '24h' then now() + interval '24 hours'
    when '7d'  then now() + interval '7 days'
    else null
  end,
  now() - (n.mins_ago || ' minutes')::interval,
  (random() * 14)::int,
  '{}'::uuid[]
from mock_city c
cross join note n
join mock_area ar on ar.city = c.name
join mock_author a
  on a.rn = (n.seq - 1 + c.rn) % (select count(*) from mock_author);

-- ------------------------------------------------------------
-- 4. 聊天室（每城 6 个，共 18 个）：圆形围栏，半径 300~800 米
--    名字带城市后缀，否则三城会出现三个同名房间，列表里分不清。
-- ------------------------------------------------------------
with room (seq, base_name, lat_off, lng_off, radius, mins_ago) as (
  values
    (1, '🚗 堵车吐槽室',     0.0080, -0.0050, 600, 240),
    (2, '🎤 演唱会散场接头', 0.0042,  0.0061, 500, 180),
    (3, '🎪 临时市集',      -0.0031,  0.0083, 400, 300),
    -- 半径最小给到 500：人不可能正好站在市中心那个点上，
    -- 300 米会把站在围栏边缘的人判成「不在围栏内」，只能看不能说
    (4, '🌧️ 一起躲雨的人',   -0.0021, -0.0048, 500, 120),
    (5, '🍜 夜宵搭子·营业中', -0.0048, -0.0056, 700, 420),
    (6, '🐱 喂猫情报站',    -0.0038,  0.0036, 350, 600)
)
insert into public.nut_chats
  (created_by, area_id, name, latitude, longitude, radius, shape, polygon, is_active, created_at)
select
  a.id,
  ar.id,
  r.base_name || '（' || c.name || '）',
  c.lat + r.lat_off,
  c.lng + r.lng_off,
  r.radius,
  'circle',
  null,
  true,
  now() - (r.mins_ago || ' minutes')::interval
from mock_city c
cross join room r
join mock_area ar on ar.city = c.name
join mock_author a
  on a.rn = (r.seq - 1 + c.rn) % (select count(*) from mock_author)
where not exists (
  select 1 from public.nut_chats x
  where x.name = r.base_name || '（' || c.name || '）'
);

-- 刚建好的房间：城市 + 基础名 + id + 中心点，供下面插消息用
create temp table mock_room as
select c.rn as city_rn, b.base, ch.id, ch.latitude, ch.longitude
from mock_city c
cross join (
  select unnest(array[
    '🚗 堵车吐槽室', '🎤 演唱会散场接头', '🎪 临时市集',
    '🌧️ 一起躲雨的人', '🍜 夜宵搭子·营业中', '🐱 喂猫情报站'
  ]) as base
) b
join public.nut_chats ch on ch.name = b.base || '（' || c.name || '）';

-- ------------------------------------------------------------
-- 5. 聊天消息（每城 40 条，共 120 条）
--    时间在各房间创建之后递增；sent_lat/sent_lng 落在围栏内，
--    这样进房间是「可发言」状态，而不是一片灰的只读态。
-- ------------------------------------------------------------
with msg (room_base, seq, body, mins_ago, lat_off, lng_off) as (
  values
    ('🚗 堵车吐槽室', 1, '上了匝道就开始挪，谁也别催谁',            210,  0.0010, -0.0010),
    ('🚗 堵车吐槽室', 2, '我在这条道上已经认全了前后五辆车的车牌',    186,  0.0008,  0.0006),
    ('🚗 堵车吐槽室', 3, '刚刚有人变道不打灯，全车喇叭齐鸣',         152, -0.0006,  0.0011),
    ('🚗 堵车吐槽室', 4, '前方事故处理完了，开始动了！',             96,  0.0004, -0.0008),
    ('🚗 堵车吐槽室', 5, '动了两百米又停了，我服了',                 61, -0.0011, -0.0004),
    ('🚗 堵车吐槽室', 6, '有同路的吗？我在中间车道，白色 SUV',        33,  0.0009,  0.0009),
    ('🚗 堵车吐槽室', 7, '终于下来了，祝还在上面的兄弟好运',          12, -0.0007,  0.0007),

    ('🎤 演唱会散场接头', 1, '散场了散场了，人太多了',                168,  0.0007, -0.0009),
    ('🎤 演唱会散场接头', 2, '我在东侧出口，举着一根应援棒',           141,  0.0005,  0.0008),
    ('🎤 演唱会散场接头', 3, '安可唱了三首，值回票价',                118, -0.0008,  0.0005),
    ('🎤 演唱会散场接头', 4, '谁要一起去吃夜宵？我这边两个人',          74,  0.0012,  0.0003),
    ('🎤 演唱会散场接头', 5, '地铁要排队，建议先走一段再打',           45, -0.0004, -0.0007),
    ('🎤 演唱会散场接头', 6, '我在路口那家便利店门口，穿黑外套',        19,  0.0006,  0.0011),

    ('🎪 临时市集', 1, '市集今天出摊了，手冲咖啡那家排了十几个人',      280,  0.0006,  0.0006),
    ('🎪 临时市集', 2, '手作耳环那摊可以砍价，我砍下来二十',          243, -0.0005,  0.0009),
    ('🎪 临时市集', 3, '有个摊子在卖老式爆米花，隔着两条街就闻到',      201,  0.0009, -0.0005),
    ('🎪 临时市集', 4, '几点收摊啊？我下了班赶过来',                157, -0.0007, -0.0008),
    ('🎪 临时市集', 5, '问了老板，说撑到九点',                      112,  0.0004,  0.0010),
    ('🎪 临时市集', 6, '刚到，还有摊位空着，想摆摊的来',             68, -0.0010,  0.0004),
    ('🎪 临时市集', 7, '明后天还有吗？',                           27,  0.0008, -0.0009),

    ('🌧️ 一起躲雨的人', 1, '雨突然好大，全跑屋檐底下了',            108,  0.0004, -0.0006),
    ('🌧️ 一起躲雨的人', 2, '我这边有三个人的位置，谁来',             82, -0.0006,  0.0005),
    ('🌧️ 一起躲雨的人', 3, '谁有伞能借一段？我到地铁就还',           55,  0.0005,  0.0007),
    ('🌧️ 一起躲雨的人', 4, '雨小了，我冲了，各位保重',               24, -0.0003, -0.0004),

    ('🍜 夜宵搭子·营业中', 1, '这个点还有人没睡吗',                  400,  0.0011,  0.0008),
    ('🍜 夜宵搭子·营业中', 2, '有有有，刚加完班',                    352, -0.0009,  0.0010),
    ('🍜 夜宵搭子·营业中', 3, '那家面馆还开着，我刚路过',             301,  0.0007, -0.0007),
    ('🍜 夜宵搭子·营业中', 4, '几个人？加我一个',                    248, -0.0005, -0.0009),
    ('🍜 夜宵搭子·营业中', 5, '现在三个，可以再来两个',              196,  0.0010,  0.0004),
    ('🍜 夜宵搭子·营业中', 6, '到了到了，门口那桌',                  133, -0.0008,  0.0006),
    ('🍜 夜宵搭子·营业中', 7, '老板说最后一锅了，要的赶紧',            88,  0.0006, -0.0011),
    ('🍜 夜宵搭子·营业中', 8, '吃饱了，明天见各位',                   39, -0.0004,  0.0009),

    ('🐱 喂猫情报站', 1, '老地方那只橘猫今天在，肚子圆滚滚的',        560,  0.0005,  0.0005),
    ('🐱 喂猫情报站', 2, '谁放的猫粮？我早上看见盆是空的',            498, -0.0004, -0.0006),
    ('🐱 喂猫情报站', 3, '是我放的，昨晚十点左右',                   441,  0.0007,  0.0003),
    ('🐱 喂猫情报站', 4, '猫好像有点感冒，谁懂？',                   377, -0.0006,  0.0007),
    ('🐱 喂猫情报站', 5, '别喂牛奶，会拉肚子，喂清水就行',            305,  0.0003, -0.0008),
    ('🐱 喂猫情报站', 6, '刚加了水，它还蹭我裤腿',                   214, -0.0008,  0.0004),
    ('🐱 喂猫情报站', 7, '明早谁路过？我明天出差',                   126,  0.0009,  0.0006),
    ('🐱 喂猫情报站', 8, '我来，我住这栋楼',                         58, -0.0005, -0.0005)
)
insert into public.nut_chat_messages
  (chat_id, user_id, content, sent_lat, sent_lng, created_at, read_by)
select
  r.id,
  a.id,
  m.body,
  r.latitude + m.lat_off,
  r.longitude + m.lng_off,
  now() - (m.mins_ago || ' minutes')::interval,
  '{}'::uuid[]
from msg m
join mock_room r on r.base = m.room_base
join mock_author a
  on a.rn = (m.seq - 1 + r.city_rn) % (select count(*) from mock_author)
where not exists (
  select 1 from public.nut_chat_messages x
  where x.chat_id = r.id and x.content = m.body
);

-- ------------------------------------------------------------
-- 6. 自检：预期 12 用户 / 48 留言 / 18 房间 / 120 消息
-- ------------------------------------------------------------
select
  (select count(*) from public.nut_users)                 as 用户数,
  (select count(*) from public.nut_messages)               as 留言数,
  (select count(*) from public.nut_chats where is_active)  as 活跃房间,
  (select count(*) from public.nut_chat_messages)          as 聊天消息数;

select
  case
    when latitude between 22.4 and 22.7 then '深圳'
    when latitude between 31.1 and 31.4 then '上海'
    when latitude between 39.8 and 40.1 then '北京'
    else '其他'
  end as 城市,
  count(*) as 留言数
from public.nut_messages
group by 1
order by 1;

-- ============================================================
-- 清理（演示完想恢复干净时，单独跑下面这段）
-- 按房间名后缀 / 留言正文 / 花名精确匹配，不会碰到真实数据。
-- ============================================================
-- delete from public.nut_chat_messages
--  where chat_id in (
--    select id from public.nut_chats
--    where name like '%（深圳）' or name like '%（上海）' or name like '%（北京）'
--  );
--
-- delete from public.nut_chats
--  where name like '%（深圳）' or name like '%（上海）' or name like '%（北京）';
--
-- delete from public.nut_messages where content in (
--   '这条路又堵死了，前面那辆车的刹车灯闪了一路，我都数到 200 了。',
--   '谁在广场喂鸽子？我这有半袋面包，一个人吃不完。',
--   '刚从演唱会出来，耳朵还在嗡，有人一起去吃夜宵吗？',
--   '市集那个卖手冲的摊子还在吗？我十分钟后到。',
--   '路口的红灯坏了，交警在手动指挥，注意避让。',
--   '这栋楼下有只猫，常驻，不怕人，可以摸。',
--   '雨停了，地上全是水洼，踩一脚凉的。',
--   '第一次来这儿，站在路口不知道往哪走，有没有本地人带路？',
--   '便利店关东煮卖完了，心碎。',
--   '有人捡到一个蓝色耳机吗？大概十分钟前在这附近掉的。',
--   '凌晨的地铁站只有我和打扫的阿姨，两个人各自安静。',
--   '外卖超时 40 分钟，但骑手说电动车半路没电了，算了不投诉了。',
--   '这边有个街头歌手，唱得挺好，围了一圈人。',
--   '临时市集明天还有吗？今天没逛够。',
--   '楼下在拍戏，封了半条路，绕行。',
--   '今天的云特别好看，抬头。'
-- );
--
-- delete from public.nut_users where username = any (array[
--   '夜班车司机', '人民广场鸽', '堵车诗人', '便利店夜班',
--   '梧桐树下', '地铁2号线', '外卖小哥A', '摆摊的阿姐',
--   '加班到十点', '来看演唱会的', '遛狗的老张', '实习生小鹿'
-- ]);
