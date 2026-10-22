-- 互动功能的服务端加固：点赞与已读
--
-- 背景：
-- 1. liked_by / read_by 若声明为 uuid[]，supabase-js 会把 JS 数组序列化成
--    JSON 字符串再交给 Postgres，触发 22P02（invalid input syntax for type uuid）。
--    统一改为 text[] 可彻底规避该问题。
-- 2. 点赞数此前由客户端计算后写入，任何登录用户都能把任意留言改成任意数字，
--    且并发下会 lost update。改由 RPC 在事务内完成，计数由 liked_by 派生。
-- 3. 已读标记此前逐条 update（N+1 往返），改由 RPC 一次批量完成。

-- ---------- 统一数组列类型 ----------
ALTER TABLE nut_messages
  ALTER COLUMN liked_by TYPE text[] USING liked_by::text[];

ALTER TABLE nut_chat_messages
  ALTER COLUMN read_by TYPE text[] USING read_by::text[];

-- ---------- 点赞 ----------
-- SECURITY DEFINER + FOR UPDATE：保证同一留言的点赞串行化，计数与数组始终一致
CREATE OR REPLACE FUNCTION toggle_note_like(p_message_id uuid, p_user_id uuid)
RETURNS SETOF nut_messages AS $$
DECLARE
  v_liked text[];
BEGIN
  SELECT coalesce(m.liked_by, '{}'::text[]) INTO v_liked
    FROM nut_messages m
   WHERE m.id = p_message_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_user_id::text = ANY(v_liked) THEN
    v_liked := array_remove(v_liked, p_user_id::text);
  ELSE
    v_liked := array_append(v_liked, p_user_id::text);
  END IF;

  RETURN QUERY
  UPDATE nut_messages m
     SET liked_by = v_liked,
         like_counts = coalesce(array_length(v_liked, 1), 0)
   WHERE m.id = p_message_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 点赞改走 RPC 后，不再需要放开整表的 UPDATE 权限
DROP POLICY IF EXISTS "Allow authenticated to update messages" ON nut_messages;
DROP POLICY IF EXISTS "Allow users to update like fields" ON nut_messages;

-- ---------- 已读 ----------
CREATE OR REPLACE FUNCTION mark_room_messages_read(p_chat_id uuid, p_user_id uuid)
RETURNS SETOF nut_chat_messages AS $$
BEGIN
  RETURN QUERY
  UPDATE nut_chat_messages m
     SET read_by = array_append(coalesce(m.read_by, '{}'::text[]), p_user_id::text)
   WHERE m.chat_id = p_chat_id
     AND m.user_id::text <> p_user_id::text
     AND NOT (p_user_id::text = ANY(coalesce(m.read_by, '{}'::text[])))
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- SECURITY DEFINER 函数默认对所有角色可执行，显式收回匿名/未认证调用
REVOKE EXECUTE ON FUNCTION toggle_note_like(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION mark_room_messages_read(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION toggle_note_like(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_room_messages_read(uuid, uuid) TO authenticated;
