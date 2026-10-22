-- 聊天室围栏的服务端校验
--
-- 背景：前端 canInteractInFence 只是 UI 层的 disabled + return，
-- 直接调用 REST API 就能在围栏外发言，「离开围栏自动脱敏」形同虚设。
-- 这里在 BEFORE INSERT 触发器里复算一次，与前端判定规则保持一致：
-- 没有围栏几何的历史房间放行，有围栏几何则必须命中。

-- 定位快照：插入时随消息落库，供触发器判定与后续审计
ALTER TABLE nut_chat_messages
  ADD COLUMN IF NOT EXISTS sent_lat double precision,
  ADD COLUMN IF NOT EXISTS sent_lng double precision;

-- 球面距离 + 射线法，逻辑与 src/lib/fence.js 保持一致
CREATE OR REPLACE FUNCTION nut_point_in_fence(
  p_lat double precision,
  p_lng double precision,
  p_shape text,
  p_center_lat double precision,
  p_center_lng double precision,
  p_radius double precision,
  p_polygon jsonb
) RETURNS boolean AS $$
DECLARE
  v_earth double precision := 6371000;
  v_dlat double precision;
  v_dlng double precision;
  v_a double precision;
  v_pts jsonb;
  v_n int;
  v_i int;
  v_j int;
  v_xi double precision;
  v_yi double precision;
  v_xj double precision;
  v_yj double precision;
  v_inside boolean := false;
BEGIN
  IF p_shape = 'polygon' AND p_polygon IS NOT NULL AND jsonb_array_length(p_polygon) >= 3 THEN
    v_pts := p_polygon;
    v_n := jsonb_array_length(v_pts);
    v_j := v_n - 1;
    FOR v_i IN 0..v_n - 1 LOOP
      v_xi := (v_pts->v_i->0)::text::double precision;
      v_yi := (v_pts->v_i->1)::text::double precision;
      v_xj := (v_pts->v_j->0)::text::double precision;
      v_yj := (v_pts->v_j->1)::text::double precision;
      -- 该条件成立时 yi <> yj，下面的除法不会除零
      IF (v_yi > p_lat) <> (v_yj > p_lat) THEN
        IF p_lng < ((v_xj - v_xi) * (p_lat - v_yi)) / (v_yj - v_yi) + v_xi THEN
          v_inside := NOT v_inside;
        END IF;
      END IF;
      v_j := v_i;
    END LOOP;
    RETURN v_inside;
  END IF;

  v_dlat := radians(p_lat - p_center_lat);
  v_dlng := radians(p_lng - p_center_lng);
  v_a := sin(v_dlat / 2) ^ 2
       + cos(radians(p_center_lat)) * cos(radians(p_lat)) * sin(v_dlng / 2) ^ 2;
  RETURN (v_earth * 2 * atan2(sqrt(v_a), sqrt(1 - v_a))) <= coalesce(p_radius, 300);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION nut_chat_fence_guard() RETURNS trigger AS $$
DECLARE
  v_chat record;
  v_has_geom boolean;
BEGIN
  SELECT shape, latitude, longitude, radius, polygon INTO v_chat
    FROM nut_chats
   WHERE id = NEW.chat_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '聊天室不存在';
  END IF;

  IF v_chat.shape = 'polygon' THEN
    v_has_geom := v_chat.polygon IS NOT NULL
                  AND jsonb_array_length(v_chat.polygon::jsonb) >= 3;
  ELSE
    v_has_geom := v_chat.latitude IS NOT NULL AND v_chat.longitude IS NOT NULL;
  END IF;

  -- 历史房间没有围栏几何时放行，避免一次迁移把老房间全部变只读
  IF NOT v_has_geom THEN
    RETURN NEW;
  END IF;

  IF NEW.sent_lat IS NULL OR NEW.sent_lng IS NULL THEN
    RAISE EXCEPTION '缺少定位信息，无法发言';
  END IF;

  IF NOT nut_point_in_fence(
    NEW.sent_lat, NEW.sent_lng, v_chat.shape,
    v_chat.latitude, v_chat.longitude, v_chat.radius, v_chat.polygon::jsonb
  ) THEN
    RAISE EXCEPTION '不在该聊天室的围栏内，无法发言';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_fence_guard ON nut_chat_messages;
CREATE TRIGGER trg_chat_fence_guard
BEFORE INSERT ON nut_chat_messages
FOR EACH ROW EXECUTE FUNCTION nut_chat_fence_guard();
