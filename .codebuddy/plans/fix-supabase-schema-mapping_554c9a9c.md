---
name: fix-supabase-schema-mapping
overview: 修复代码中的 Supabase 表名和字段映射，使其与实际数据库结构一致
todos:
  - id: fix-write-note-modal
    content: 修复 WriteNoteModal.jsx：表名 notes 改为 nut_messages，字段 lat/lng/expiry 改为 latitude/longitude/expires_at
    status: completed
  - id: fix-create-room-modal
    content: 修复 CreateRoomModal.jsx：表名 rooms 改为 nut_chats，字段 user_id 改为 created_by，移除不存在的 lat/lng/type/expires_at 字段
    status: completed
  - id: fix-use-store
    content: 修复 useStore.js：修改 fetchNotes/fetchRooms/fetchMessages 中的表名和字段映射，关联查询 users 改为 nut_users
    status: completed
  - id: fix-profile-page
    content: 修复 ProfilePage.jsx：表名改为 nut_users/nut_messages/nut_chats，字段 nickname 改为 username，created_by 替换 user_id，移除 credit_score
    status: completed
  - id: fix-chat-page
    content: 修复 ChatPage.jsx：表名 messages 改为 nut_chat_messages，关联查询 users 改为 nut_users，修复 nickname 为 username
    status: completed
---

## 用户需求

修复发布消息时报错 `Could not find the 'expiry' column of 'notes' in the schema cache` 的问题。

## 产品概述

Nut 应用的前端代码与 Supabase 数据库表结构不匹配，导致发布留言、创建聊天室等功能无法正常工作。

## 核心功能修复

1. 修复留言发布功能 - 表名和字段映射错误
2. 修复聊天室创建功能 - 表名和字段映射错误
3. 修复个人资料页数据加载 - 表名和字段映射错误
4. 修复首页附近留言/聊天室加载 - store 中的查询映射错误
5. 修复聊天页消息发送和订阅 - 表名映射错误

## 技术栈

- 前端框架: React + Vite
- 状态管理: Zustand
- 数据库: Supabase (自建实例)
- 地图: MapLibre GL

## 实现方案

### 问题根源

代码中使用的表名和字段与实际 Supabase 数据库表结构完全不匹配：

| 代码表名 | 实际表名 |
| --- | --- |
| notes | nut_messages |
| rooms | nut_chats |
| users | nut_users |
| messages | nut_chat_messages |


### 字段映射差异

**nut_messages 表 (代码中的 notes)**

| 代码字段 | 实际字段 | 说明 |
| --- | --- | --- |
| lat | latitude | 纬度 |
| lng | longitude | 经度 |
| expiry | expires_at | 过期时间 |


**nut_chats 表 (代码中的 rooms)**

| 代码字段 | 实际字段 | 说明 |
| --- | --- | --- |
| user_id | created_by | 创建者 |
| lat/lng | 无 | 不存在，需移除 |
| type | 无 | 不存在，需移除 |
| expires_at | 无 | 不存在，需移除 |


**nut_users 表 (代码中的 users)**

| 代码字段 | 实际字段 | 说明 |
| --- | --- | --- |
| nickname | username | 用户名 |
| credit_score | 无 | 不存在，需移除或硬编码 |


### 实现要点

1. 统一修改所有 Supabase 查询的表名
2. 修正字段名映射
3. 移除不存在的字段引用
4. 调整关联查询的外键字段名

## 目录结构

```
src/
├── components/
│   ├── WriteNoteModal.jsx    # [MODIFY] 修改表名 notes->nut_messages，字段 lat->latitude, lng->longitude, expiry->expires_at
│   └── CreateRoomModal.jsx   # [MODIFY] 修改表名 rooms->nut_chats，字段 user_id->created_by，移除 lat/lng/type/expires_at
├── pages/
│   ├── HomePage.jsx          # [MODIFY] 检查并修复可能的表查询引用
│   ├── ProfilePage.jsx       # [MODIFY] 修改表名和字段映射，修复 nickname->username，移除 credit_score
│   └── ChatPage.jsx          # [MODIFY] 修改表名 messages->nut_chat_messages，修复关联查询 users->nut_users
└── stores/
    └── useStore.js           # [MODIFY] 修改 fetchNotes/fetchRooms/fetchMessages 中的表名和字段
```