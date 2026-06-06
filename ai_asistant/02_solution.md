# AI 编剧助理 — 对话记忆系统解决方案

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ChatSidebar ──→ API calls ──→ Backend                       │
└─────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (FastAPI)                         │
│                                                               │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │ Chat API    │──→│ Chat Service │──→│ Memory Manager   │  │
│  │ (routes)    │   │ (business)   │   │ (context build)  │  │
│  └─────────────┘   └──────────────┘   └───────┬──────────┘  │
│                                                │              │
│                          ┌─────────────────────┤              │
│                          ▼                     ▼              │
│                   ┌──────────┐        ┌──────────────┐      │
│                   │  Redis   │        │   Database   │      │
│                   │ (cache)  │        │  (persist)   │      │
│                   └──────────┘        └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 核心设计原则

**Write-through + Cache-aside 混合策略**：

- **写入**：消息同时写入 DB 和 Redis（write-through），保证持久性
- **读取**：优先从 Redis 读取（cache-aside），miss 时从 DB 加载并回填 Redis
- **降级**：Redis 不可用时自动切换到纯 DB 模式

## 2. 数据库设计

### 2.1 新增表：`chat_sessions`

```sql
CREATE TABLE chat_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id     INTEGER NOT NULL REFERENCES conversion_tasks(id) ON DELETE CASCADE,
    title       VARCHAR(100),                          -- 从首条消息自动截取
    message_count INTEGER NOT NULL DEFAULT 0,          -- 冗余计数，加速列表查询
    created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
    updated_at  DATETIME NOT NULL DEFAULT (datetime('now')),
    
    UNIQUE(user_id, task_id)                           -- 一个任务一个对话
);

CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_task ON chat_sessions(task_id);
```

### 2.2 新增表：`chat_messages`

```sql
CREATE TABLE chat_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role          VARCHAR(10) NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content       TEXT NOT NULL,                       -- 消息文本
    
    -- AI 消息的结构化数据（仅 role='assistant' 时有值）
    modified_yaml   TEXT,                              -- 建议修改的 YAML
    change_summary  TEXT,                              -- 变更摘要
    changes_json    TEXT,                              -- JSON: [{type, target, description}]
    accepted        BOOLEAN,                           -- 用户是否接受
    rejected        BOOLEAN,                           -- 用户是否拒绝
    
    token_count     INTEGER,                           -- 本条消息的 token 估算
    created_at    DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, created_at);
```

### 2.3 数据关系

```
User (1) ──< (N) ConversionTask
                  │
                  │ (1:1)
                  ▼
            ChatSession (1) ──< (N) ChatMessage
```

## 3. Redis 数据结构设计

### 3.1 消息缓存

```
Key:    chat:session:{session_id}:messages
Type:   List (或 ZSET 按 created_at 排序)
Value:  JSON 序列化的消息对象数组
Size:   最多 40 条（最近 20 轮 × 2 = user + assistant）
TTL:    24 小时（可配置）
```

单个消息 JSON 格式：
```json
{
  "id": 123,
  "role": "user",
  "content": "把第二幕萧炎的台词改得更愤怒一点",
  "created_at": "2026-06-06T10:30:00Z"
}
```

### 3.2 Session 元数据缓存

```
Key:    chat:session:{session_id}:meta
Type:   Hash
Fields:  session_id, user_id, task_id, message_count, updated_at
TTL:    24 小时
```

### 3.3 活跃 Session 索引（可选）

```
Key:    chat:active_sessions
Type:   ZSET (score = last_activity_timestamp)
Purpose: 快速定位需要过期清理的 session
```

### 3.4 上下文窗口配置

```
Key:    chat:config
Type:   Hash
Fields:  max_context_messages=40  (最近 N 条消息)
         context_ttl_hours=24     (缓存有效期)
```

## 4. 数据流

### 4.1 打开对话（加载历史）

```
User opens chat
       │
       ▼
GET /tasks/{id}/chat/session
       │
       ▼
Check Redis: chat:session:{sid}:messages
       │
   ┌───┴───┐
   │ Hit?  │
   └───┬───┘
       │
   ┌───Yes───────────────────────────────┐
   │ Return messages from Redis           │
   │ (sub-millisecond)                    │
   └──────────────────────────────────────┘
       │
       No
       │
       ▼
Load from DB: SELECT * FROM chat_messages
WHERE session_id = ? ORDER BY created_at DESC LIMIT 40
       │
       ▼
Transform → JSON → Write to Redis (回填)
       │
       ▼
Return to frontend
```

### 4.2 发送消息（写入）

```
User sends instruction
       │
       ▼
POST /tasks/{id}/chat
       │
       ▼
1. Upsert session (INSERT OR IGNORE)
       │
       ▼
2. Save user message to DB
       │
       ▼
3. Load recent messages (Redis → DB fallback)
       │
       ▼
4. Build context (last N messages formatted for LLM)
       │
       ▼
5. Call LLM with context + current YAML + instruction
       │
       ▼
6. Save AI response to DB
       │
       ▼
7. Push both messages to Redis list (LTRIM to keep size)
       │
       ▼
8. Return ChatEditResponse to frontend
```

### 4.3 上下文构建算法

```python
def build_context(messages: list[ChatMessage], max_messages: int = 40) -> str:
    """
    将消息历史构建为 LLM 可理解的上下文字符串。
    
    策略：
    - 取最近 max_messages 条消息
    - 用户消息保留原文
    - AI 消息只保留 change_summary（不含完整 YAML，节省 token）
    - 超过窗口的旧消息提供一句摘要
    """
    recent = messages[-max_messages:]
    
    lines = ["## 对话历史\n"]
    
    for msg in recent:
        if msg.role == "user":
            lines.append(f"用户: {msg.content}")
        elif msg.role == "assistant":
            summary = msg.change_summary or msg.content[:100]
            lines.append(f"AI 助手: [修改] {summary}")
    
    if len(messages) > max_messages:
        omitted = len(messages) - max_messages
        lines.insert(0, f"(省略了较早的 {omitted} 条消息)\n")
    
    return "\n".join(lines)
```

## 5. API 设计

### 5.1 获取或创建 Session

```
GET /api/v1/conversion/tasks/{task_id}/chat/session

Response:
{
  "session_id": 42,
  "title": "讨论萧炎角色弧光",
  "message_count": 15,
  "messages": [
    {
      "id": 1,
      "role": "user",
      "content": "...",
      "created_at": "..."
    },
    {
      "id": 2,
      "role": "assistant",
      "content": "...",
      "change_summary": "...",
      "changes": [...],
      "accepted": true,
      "rejected": false,
      "created_at": "..."
    },
    ...
  ],
  "created_at": "...",
  "updated_at": "..."
}
```

### 5.2 发送消息（增强已有端点）

```
POST /api/v1/conversion/tasks/{task_id}/chat

Request (增强):
{
  "instruction": "把第二幕萧炎的台词改得更愤怒一点",
  "current_yaml": "...",
  "session_id": 42               // + 新增：关联 session
}

Response (不变):
{
  "modified_yaml": "...",
  "change_summary": "...",
  "changes": [...] 
}
```

### 5.3 删除对话历史

```
DELETE /api/v1/conversion/tasks/{task_id}/chat/session

→ 删除该 session 的所有消息 + Redis 缓存
→ 204 No Content
```

### 5.4 导出对话

```
GET /api/v1/conversion/tasks/{task_id}/chat/session/export?format=json

→ 下载完整对话历史（JSON 或 Markdown）
```

## 6. 实现方案对比

### 方案 A：Redis 缓存 + DB 持久化（推荐）

| 维度 | 评价 |
|------|------|
| 延迟 | 极低（Redis < 1ms） |
| 可靠性 | DB 保证不丢数据，Redis 挂了自动降级 |
| 复杂度 | 中（需维护 Redis + DB 一致性） |
| 部署 | 需额外部署 Redis（或用云服务） |
| 成本 | 低（Redis 内存占用极小，每 session 约 50KB） |

### 方案 B：纯 DB（SQLite/MySQL）

| 维度 | 评价 |
|------|------|
| 延迟 | 可接受（索引查询 < 5ms） |
| 可靠性 | 高（单一数据源） |
| 复杂度 | 低（无缓存层） |
| 部署 | 简单（无额外组件） |
| 成本 | 最低 |

### 方案 C：纯 Redis（无 DB 持久化）

| 维度 | 评价 |
|------|------|
| 延迟 | 极低 |
| 可靠性 | 差（重启丢失） |
| 适用 | 仅适合原型/演示 |

### 推荐：方案 A，但 Redis 设计为可选组件

```python
# backend/services/memory_manager.py

class MemoryManager:
    def __init__(self, use_redis: bool = True):
        self.redis = RedisClient() if use_redis else None
    
    async def get_messages(self, session_id: int) -> list[dict]:
        # Try Redis first
        if self.redis:
            cached = await self.redis.get(f"chat:session:{session_id}:messages")
            if cached:
                return json.loads(cached)
        
        # Fall back to DB
        messages = await self._load_from_db(session_id)
        
        # Backfill Redis
        if self.redis and messages:
            await self._cache_messages(session_id, messages)
        
        return messages
```

## 7. 实现计划

### Phase 1：基础持久化（1-2 天）

1. 创建 `chat_sessions` 和 `chat_messages` 数据库模型
2. 实现 ChatSession CRUD 服务
3. 修改 `POST /tasks/{id}/chat` 端点：
   - 保存用户消息到 DB
   - 保存 AI 响应到 DB
   - 构建上下文时从 DB 加载最近消息
4. 新增 `GET /tasks/{id}/chat/session` 端点（加载历史）
5. 前端：ChatSidebar 打开时加载历史消息并展示

### Phase 2：Redis 缓存层（1 天）

1. 添加 Redis 依赖（`redis-py` + `redis` 服务）
2. 实现 MemoryManager（Redis + DB 双写）
3. 配置 TTL 和最大消息数
4. 实现降级逻辑（Redis 不可用时自动切换）
5. 压测验证延迟指标

### Phase 3：高级特性（按需）

1. 上下文窗口智能裁剪（超窗消息摘要化）
2. 对话导出（JSON / Markdown）
3. Token 计数与配额管理
4. 对话标题自动生成（从首条消息提取）

## 8. 配置项

```yaml
# config.yaml 新增
chat_memory:
  max_context_messages: 40      # 上下文窗口大小（条数，约 20 轮对话）
  redis_ttl_hours: 24           # Redis 缓存有效期
  redis_enabled: true           # 是否启用 Redis（false 时纯 DB 模式）
  redis_url: "redis://localhost:6379/0"
  context_summary_enabled: true # 超窗消息是否自动摘要
```

## 9. 关键决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| Session 粒度 | 1 task = 1 session | 需求明确要求任务间隔离，一对一关系最简单 |
| 消息存储 | DB 全量 + Redis 热缓存 | 持久性 + 性能兼顾 |
| 上下文构建 | 最近 N 条，AI 消息只含摘要 | 节省 LLM token，避免 YAML 膨胀上下文 |
| Redis 角色 | 可选缓存，非必需 | 降低部署复杂度，小规模场景 DB 性能足够 |
| 消息 ID | 全局自增整数 | 简单可靠，便于分页和排序 |
| AI 消息结构化 | changes_json 存储为 JSON 字符串 | SQLite 无原生 JSON 类型，字符串兼容性最好 |
