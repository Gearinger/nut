# 此时此地 - 技术栈 (TECH_STACK)

## 1. 技术选型

### 1.1 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| React | 18.x | UI 框架 |
| Vite | 5.x | 构建工具 |
| TypeScript | 5.x | 类型安全 |
| MapLibre GL | 3.x | 地图渲染 |
| React Router | 6.x | 路由管理 |
| Zustand | 4.x | 状态管理 |
| TanStack Query | 5.x | 数据请求 |

### 1.2 后端 (BaaS)

| 技术 | 版本 | 用途 |
|------|------|------|
| Supabase | 最新 | 后端即服务 |
| PostgreSQL | 15.x | 关系数据库 |
| PostGIS | 3.x | 地理信息扩展 |
| Redis | 最新 | 缓存、会话 |
| WebSocket | - | 实时消息 |

### 1.3 AI 服务

| 服务 | 用途 |
|------|------|
| 内容审核 API | 文本/图片审核 |
| 语音识别 | 语音转文字（可选） |

### 1.4 基础设施

| 服务 | 用途 |
|------|------|
| Vercel | 前端部署 |
| Supabase Cloud | 后端服务 |
| 阿里云 | 备用云服务 |

---

## 2. 数据库设计

### 2.1 表结构

```sql
-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(255) UNIQUE,
  username VARCHAR(50) NOT NULL,
  avatar_url TEXT,
  credit_score INT DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 围栏表
CREATE TABLE fences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  radius INT NOT NULL, -- 米
  password_hash TEXT,
  is_public BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'pending', -- pending, active, expired, closed
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 帖子表
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fence_id UUID REFERENCES fences(id),
  user_id UUID REFERENCES users(id),
  content TEXT,
  media_urls TEXT[], -- 图片/视频 URL 数组
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- 消息表
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fence_id UUID REFERENCES fences(id),
  user_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 私聊表
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts(id),
  user_id_1 UUID REFERENCES users(id),
  user_id_2 UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 聊天消息表
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES chats(id),
  sender_id UUID REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 围栏成员表
CREATE TABLE fence_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fence_id UUID REFERENCES fences(id),
  user_id UUID REFERENCES users(id),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(fence_id, user_id)
);
```

### 2.2 地理空间索引

```sql
-- 创建空间索引
CREATE INDEX fences_location_idx ON fences USING GIST (
  ST_MakePoint(center_lng, center_lat)
);

-- 查询范围内的围栏
CREATE OR REPLACE FUNCTION get_nearby_fences(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  radius_meters INT
)
RETURNS SETOF fences AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM fences
  WHERE ST_DWithin(
    ST_MakePoint(center_lng, center_lat)::geography,
    ST_MakePoint(lng, lat)::geography,
    radius_meters
  )
  AND status = 'active'
  AND (end_time IS NULL OR end_time > NOW());
END;
$$ LANGUAGE plpgsql;
```

---

## 3. API 设计

### 3.1 认证

| 接口 | 方法 | 描述 |
|------|------|------|
| /auth/login | POST | 手机号/邮箱登录 |
| /auth/verify | POST | 验证码验证 |
| /auth/refresh | POST | 刷新 Token |

### 3.2 围栏

| 接口 | 方法 | 描述 |
|------|------|------|
| /fences | GET | 获取附近围栏列表 |
| /fences/:id | GET | 获取围栏详情 |
| /fences | POST | 创建围栏 |
| /fences/:id/join | POST | 加入围栏 |
| /fences/:id/leave | POST | 离开围栏 |

### 3.3 内容

| 接口 | 方法 | 描述 |
|------|------|------|
| /fences/:id/posts | GET | 获取空间流 |
| /posts | POST | 发布帖子 |
| /fences/:id/messages | GET | 获取实时消息 |
| /fences/:id/messages | POST | 发送消息 |

### 3.4 聊天

| 接口 | 方法 | 描述 |
|------|------|------|
| /chats | POST | 创建私聊 |
| /chats/:id/messages | GET | 获取聊天记录 |
| /chats/:id/messages | POST | 发送私聊消息 |

---

## 4. 安全措施

### 4.1 身份认证
- JWT Token 认证
- Token 刷新机制
- 敏感操作二次验证

### 4.2 位置安全
- GPS + WiFi + 蓝牙多源定位
- 异常位置检测
- 伪造位置检测

### 4.3 内容安全
- AI 文本审核
- AI 图片审核
- 敏感词过滤
- 举报机制

---

## 5. 部署

### 5.1 前端
```bash
# 构建
npm run build

# 部署到 Vercel
vercel --prod
```

### 5.2 后端
- Supabase Cloud（托管 PostgreSQL + API）
- WebSocket 通过 Supabase Realtime

---

*Version: 1.0*
*Created: 2026-03-14*
