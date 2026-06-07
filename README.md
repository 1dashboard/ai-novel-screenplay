# Demo视频链接

https://video.weibo.com/show?fid=1034:5307249745133652

# AI 小说转剧本系统

基于大语言模型（LLM）的小说到好莱坞标准剧本自动转换系统。支持 TXT、Markdown、DOCX、DOC、PDF 等多种格式的小说输入，通过 DeepSeek / Anthropic Claude 模型驱动章节分析，自动提取角色、场景、对白等结构化信息，输出标准 YAML 剧本，并提供 Web 界面和命令行工具。

## 功能特性

### 核心转换引擎

- **多格式解析** — 支持 TXT、Markdown、DOCX、DOC、PDF 五种小说文件格式，自动检测文件类型并选择合适的解析器
- **智能章节检测** — 内置中英文正则模式库，自动识别章节标题（如「第一章」「Chapter 1」「第001章」等）并拆分文本
- **LLM 驱动分析** — 调用 DeepSeek 或 Anthropic Claude 模型逐章分析，提取角色信息（姓名、别名、性别、年龄区间、性格特征、外貌描述、人际关系）、场景结构（场景标题、地点、时间、出场角色、剧情概要）和内容元素（动作描述、对白、表演指示、转场指令、分析备注）
- **并行加速** — 多线程并发分析章节，默认 6 线程并发，支持配置调整；10 章小说的分析时间从约 4 分钟压缩至约 1 分钟（约 4 倍速度提升）
- **角色去重合并** — 跨章节角色自动识别，通过名称匹配和别名比对实现智能合并，关系网络去重整合
- **智能分幕** — LLM 根据叙事转折点、情感高潮、时间跳跃、地点转换自动划分幕结构（2-7 幕灵活适配），并为每幕生成 2-6 字贴合故事本质的标题
- **三幕兜底** — LLM 分幕失败时，自动使用 25%/50%/25% 经典三幕比例兜底划分
- **质量评估** — 三维度量化评分体系（结构校验 40 分 / 格式规范 30 分 / 内容质量 30 分），总分 0-100 分；检测缺失角色、空场景、格式异常等 20+ 种常见问题
- **结构化警告** — 评估问题精确标注对应的场景/角色，前端可点击跳转到对应位置快速定位

### Web 应用

#### 用户系统

- **认证** — 注册、登录、JWT 双令牌机制（30 分钟访问令牌 + 7 天刷新令牌），密码使用 bcrypt 哈希存储
- **安全** — 令牌刷新、密码重置、账号注销、登录历史记录、设备会话管理
- **配额** — 每用户可配置每日/每月转换次数上限，超出后友好提示
- **个人设置** — 修改密码、头像上传、个人信息编辑

#### 转换流程

- **文件上传** — 支持腾讯云 COS 直传和服务器中转两种模式，最大 50MB，实时上传进度条
- **自定义 Prompt** — 上传时可选择预置模板（经典三幕式电影 / 快节奏动作大片 / 情感文艺片 / 标准网剧 / 悬疑烧脑剧 / 短视频爽剧 / 热血战斗番 / 治愈日常番 / 话剧改编）或手写自定义分析提示词，控制分析风格和输出侧重
- **实时进度** — SSE（Server-Sent Events）推送转换进度，Redis Pub/Sub 桥接 Celery Worker 与 Web 进程，支持多 Worker 环境下的实时推送；从文件解析到场景编号阶段的每一步均有独立的进度消息

#### 剧本浏览与编辑

- **分屏预览** — 左侧场景树（支持幕折叠展开、场景点击切换）+ 右侧场景详情（好莱坞标准格式渲染），桌面端分栏、移动端自动切换为下拉选择器
- **角色关系图** — 节点-连线式可视化角色网络，点击角色高亮其所有出场场景，支持缩放拖拽
- **评估仪表盘** — 评分环形图、分维度得分柱状图、警告列表（可点击跳转到对应场景/角色）
- **内联编辑** — 场景标题、对白文本、动作描述、表演指示、幕标题支持点击直接编辑，Ctrl+S 手动保存或停止输入 2 秒自动保存
- **YAML 源码编辑** — 提供带行号的 YAML 编辑器，实时统计角色数/幕数/场景数，语法校验即时反馈

#### AI 编剧助手

- **自然语言交互** — 对话式修改剧本，如「把场景 1 中萧媚的内心独白丰富一下」「将第 3 幕的战斗场面拆成 3 个独立场景」「给主角增加一段悲壮的独白」
- **差异对比** — 每次修改生成 diff 视图，绿色标注新增、红色标注删除、黄色标注修改，支持逐条接受或拒绝
- **对话记忆** — 对话历史持久化到 MySQL + Redis 双层缓存，支持上下文窗口智能裁剪（基于 token 计数），自动生成对话标题
- **对话导出** — 支持将对话记录导出为 JSON 或 Markdown 格式

#### 导出功能

- **YAML 原始数据** — 完整剧本结构化数据，包含全部元信息
- **TXT 纯文本剧本** — 格式化的标准剧本文本，含角色列表和分幕场景
- **HTML 打印 PDF** — 精美的排版 HTML 页面，自动打开打印对话框，可直接保存为 PDF
- **DOCX Word 文档** — 带样式的 .docx 文件，含标题层级、角色标签、场景格式等专业排版

#### 其他

- **管理后台** — 用户列表（搜索/分页/编辑）、系统统计看板（总用户数/任务数/存储量）、用户配额管理
- **响应式设计** — Tailwind CSS 响应式断点，桌面/平板/手机全适配
- **暗色模式** — 全站支持亮色/暗色主题切换
- **Toast 通知** — 全局操作反馈（成功/错误/警告/信息），自动消失

### 命令行工具

```bash
# 基本转换
python main.py convert novel.txt -o output.yaml

# 指定模型和参数
python main.py convert novel.md --model deepseek-chat --temperature 0.5 -o output.yaml

# 纯结构模板（不使用 LLM，仅提取章节结构）
python main.py convert novel.docx --no-llm -o template.yaml

# 验证已有剧本 YAML
python main.py validate output.yaml

# 列出可用模型
python main.py models
```

## 技术栈

| 层级                | 技术                                              | 版本要求               |
| ------------------- | ------------------------------------------------- | ---------------------- |
| **后端框架**        | FastAPI (Uvicorn/Gunicorn)                        | Python 3.10+           |
| **异步任务**        | Celery + Redis                                    | Celery 5.x, Redis 6.0+ |
| **数据库**          | MySQL（生产）/ SQLite（开发）                     | MySQL 8.0+             |
| **ORM**             | SQLAlchemy                                        | 2.0+                   |
| **数据校验**        | Pydantic                                          | 2.x                    |
| **缓存 / 消息队列** | Redis（会话缓存 / 令牌桶限流 / Pub/Sub SSE 推送） | 6.0+                   |
| **速率控制**        | Redis 令牌桶（Lua 原子操作）、slowapi             | -                      |
| **对象存储**        | 腾讯云 COS                                        | -                      |
| **LLM**             | DeepSeek / Anthropic Claude                       | -                      |
| **前端**            | React + TypeScript + Vite                         | React 19, Vite 8       |
| **CSS**             | Tailwind CSS                                      | 4.x                    |
| **图表**            | Recharts                                          | -                      |
| **文档生成**        | docx (Word 导出)                                  | -                      |
| **CLI**             | Typer + Rich                                      | -                      |
| **测试**            | pytest                                            | -                      |

## 系统架构

```
┌─────────────────────────────────────────────────┐
│                    前端 (React)                   │
│         Vite Dev Server :5173                    │
│         Proxy /api → :8000                       │
└─────────────────┬───────────────────────────────┘
                  │ HTTP / SSE
┌─────────────────▼───────────────────────────────┐
│              后端 Web (FastAPI)                   │
│         Uvicorn :8000 / Gunicorn                 │
│  ┌──────────────────────────────────────────┐   │
│  │ API 路由                                  │   │
│  │ /api/v1/auth/*      认证 (注册/登录/刷新) │   │
│  │ /api/v1/conversion/* 转换 (上传/任务/SSE) │   │
│  │ /api/v1/admin/*     管理 (统计/用户管理)   │   │
│  ├──────────────────────────────────────────┤   │
│  │ 服务层                                    │   │
│  │ auth_service        认证 + JWT 令牌管理   │   │
│  │ conversion_service  转换编排 + 进度跟踪   │   │
│  │ chat_service        AI 聊天 + 上下文管理  │   │
│  │ cos_service         腾讯云 COS 对象存储   │   │
│  │ stream              Redis Pub/Sub SSE     │   │
│  │ llm_rate_limiter    Redis 令牌桶速率控制  │   │
│  │ quota_service       用户配额管理          │   │
│  │ memory_manager      聊天 Redis 缓存       │   │
│  ├──────────────────────────────────────────┤   │
│  │ ORM 模型                                  │   │
│  │ User / RefreshToken / LoginHistory        │   │
│  │ ConversionTask / ScreenplayRecord         │   │
│  │ ChatSession / ChatMessage / UserQuota     │   │
│  └──────────────────────────────────────────┘   │
└──────┬──────────────────────┬───────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐    ┌──────────────────────┐
│    MySQL      │    │        Redis          │
│  用户 / 任务  │    │  缓存 / 令牌桶 /      │
│  剧本 / 聊天  │    │  Pub/Sub SSE 桥接    │
└──────────────┘    └────────┬─────────────┘
                             │ Pub/Sub
                    ┌────────▼─────────┐
                    │  Celery Worker    │
                    │  转换任务异步执行  │
                    │  (线程池并发分析)  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  DeepSeek /       │
                    │  Anthropic Claude │
                    └──────────────────┘
```

### 转换流水线

```
文件上传
  │
  ▼
格式检测 → 解析器提取纯文本 → 正则匹配章节标题 → 拆分章节列表
  │
  ▼
并行 LLM 分析（6 线程并发）
  ├── 第 1 章: 提取角色 → 场景 → 对白 → 备注
  ├── 第 2 章: 提取角色 → 场景 → 对白 → 备注
  ├── ...
  └── 第 N 章: 提取角色 → 场景 → 对白 → 备注
  │
  ▼
跨章节角色合并去重（名称 + 别名匹配）
  │
  ▼
场景全局编号 → 幕结构划分（LLM 智能分幕 / 三幕兜底）
  │
  ▼
AI 生成幕标题 → YAML 序列化导出 → 三维度质量评估
```

### 关键设计决策

**为什么用 Celery + Redis？**

转换任务是 CPU/IO 密集型（大量 LLM API 调用），同步执行会阻塞 Web 进程导致超时。Celery Worker 在独立进程中执行任务，Web 进程通过 Redis Pub/Sub 订阅 Worker 发布的进度消息，再通过 SSE 推送给前端。这种架构实现了 Web 进程的轻量化，支持独立扩展 Worker 数量。

**为什么用 Redis 令牌桶而非简单的速率限制？**

多个 Celery Worker 线程同时调用 LLM API，需要跨进程共享调用频率计数。Redis 令牌桶使用 Lua 脚本实现原子操作，确保 N 个 Worker 线程的总调用速率不超过配置上限，防止触发 API 提供商的 429 错误。

**为什么用 SSE 而非 WebSocket？**

转换进度是单向推送（服务端 → 客户端），SSE 比 WebSocket 更轻量——基于标准 HTTP 协议，无需握手升级，浏览器原生支持自动重连，代理/CDN 兼容性更好。

## 快速开始

### 环境要求

| 软件    | 最低版本 | 说明                                   |
| ------- | -------- | -------------------------------------- |
| Python  | 3.10+    | 后端运行环境                           |
| Node.js | 18+      | 前端构建工具链                         |
| MySQL   | 8.0+     | 持久化存储（开发环境可用 SQLite 替代） |
| Redis   | 6.0+     | 缓存 / 消息队列 / 速率控制             |

### 1. 克隆项目

```bash
git clone <repo-url>
cd ai_novel_script_project
```

### 2. 后端设置

```bash
# 安装 Python 依赖
pip install -r requirements.txt

# 创建 MySQL 数据库
mysql -u root -p -e "CREATE DATABASE novel2script CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 复制配置文件模板
cp config.example.yaml config.yaml

# 编辑 config.yaml，至少填入 LLM API Key
# 关键配置项：
#   llm.provider      — deepseek 或 anthropic
#   llm.api_key       — API 密钥（支持 ${ENV_VAR} 环境变量引用）
#   llm.model         — 模型名称（如 deepseek-chat）
```

### 3. 前端设置

```bash
cd frontend
npm install
```

### 4. 环境变量（可选）

所有配置均支持 `N2S_` 前缀的环境变量覆盖。常用变量：

| 变量                              | 默认值                                                    | 说明                             |
| --------------------------------- | --------------------------------------------------------- | -------------------------------- |
| `N2S_DATABASE_URL`                | `mysql+pymysql://root:123456@localhost:3306/novel2script` | 数据库连接串                     |
| `N2S_JWT_SECRET`                  | 开发默认值                                                | JWT 签名密钥（生产环境必须修改） |
| `N2S_ACCESS_TOKEN_EXPIRE_MINUTES` | 30                                                        | 访问令牌有效期（分钟）           |
| `N2S_REFRESH_TOKEN_EXPIRE_DAYS`   | 7                                                         | 刷新令牌有效期（天）             |
| `N2S_MAX_UPLOAD_SIZE_MB`          | 50                                                        | 上传文件大小上限（MB）           |
| `N2S_REDIS_ENABLED`               | true                                                      | 是否启用 Redis                   |
| `N2S_REDIS_HOST`                  | localhost                                                 | Redis 主机地址                   |
| `N2S_REDIS_PORT`                  | 6379                                                      | Redis 端口                       |
| `N2S_CONFIG_PATH`                 | ./config.yaml                                             | 配置文件路径                     |

### 5. 启动开发环境

**一键启动（Windows）：**

```bash
start_robust.bat
```

**一键启动（Linux/Mac）：**

```bash
chmod +x start_robust.sh
./start_robust.sh
```

**手动启动（四个终端）：**

```bash
# 终端 1: 启动 Redis
redis-server

# 终端 2: 启动 Celery Worker（转换任务执行器）
celery -A backend.celery_app worker --pool=threads --concurrency=4 -Q conversion --loglevel=info

# 终端 3: 启动后端 Web 服务
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --timeout-keep-alive 600 --log-level info

# 终端 4: 启动前端开发服务器
cd frontend && npm run dev
```

访问 **http://localhost:5173** 即可使用。

## 配置说明

### config.yaml 完整参考

```yaml
# ── LLM 配置 ───────────────────────────────────
llm:
  provider: deepseek              # 可选: anthropic | deepseek
  model: deepseek-chat            # 模型名称
  max_tokens: 6144                # 单次调用最大输出 token 数
  temperature: 0.3                # 生成温度 (0.0-1.0)，越低越稳定
  api_key: "sk-xxxxxxxx"          # API 密钥，支持 ${ENV_VAR} 环境变量引用
  base_url: https://api.deepseek.com  # API 端点（DeepSeek 需配置）

# ── 转换参数 ───────────────────────────────────
conversion:
  max_chunk_size: 10000           # 单次 LLM 调用最大输入字符数
  max_parallel_chapters: 6        # 并行分析的最大章节数
  min_chapters: 3                 # 最少章节数要求（不足则拒绝转换）
  chapter_patterns:               # 章节标题检测正则模式
    - "^第[零一二三四五六七八九十百千0-9]+章"
    - "^Chapter\\s+\\d+"
    - "^第[0-9]+节"
    - "^[0-9]+\\."                # 纯数字序号
    - "^[0-9]+、"                  # 中文数字序号

# ── 输出选项 ───────────────────────────────────
output:
  default_yaml_width: 120         # YAML 默认行宽
  allow_unicode: true             # 使用 Unicode 字符（中文必须）
  sort_keys: false                # 是否排序 YAML 键

# ── 腾讯云 COS 对象存储（可选） ────────────────
cos:
  client:
    region: ap-nanjing
    secretId: ""
    secretKey: ""
    bucket: ""
    host: ""
```

### 自定义 Prompt 模板

上传文件时可选择预置模板来调整 LLM 的分析风格和输出侧重。模板分为五大类别：

| 类别     | 模板           | 适用场景                 |
| -------- | -------------- | ------------------------ |
| 电影剧本 | 经典三幕式电影 | 90-120 分钟标准长片      |
| 电影剧本 | 快节奏动作大片 | 商业动作片、玄幻战斗题材 |
| 电影剧本 | 情感文艺片     | 都市情感、文学改编       |
| 网剧     | 标准网剧       | 12-24 集连续剧           |
| 网剧     | 悬疑烧脑剧     | 悬疑推理、反转剧情       |
| 短视频   | 短视频爽剧     | 1-2 分钟竖屏，高密度爽点 |
| 短视频   | 微短剧         | 5-10 分钟，完整故事弧光  |
| 动漫     | 热血战斗番     | 玄幻/修真/热血少年题材   |
| 动漫     | 治愈日常番     | 都市/校园/美食/治愈题材  |
| 舞台剧   | 话剧改编       | 文学性强、对白驱动的原著 |

也可手写自定义 Prompt，支持 `{character_context}` 占位符（运行时替换为已识别角色列表）。

## API 文档

启动后端后访问 **http://localhost:8000/docs** 查看 Swagger UI 交互式 API 文档。

### 完整端点列表

#### 认证 `/api/v1/auth`

| 方法   | 路径              | 认证 | 说明                                  |
| ------ | ----------------- | ---- | ------------------------------------- |
| POST   | `/register`       | 否   | 用户注册                              |
| POST   | `/login`          | 否   | 用户登录，返回 access + refresh token |
| POST   | `/refresh`        | 否   | 刷新 access token                     |
| POST   | `/password/reset` | 是   | 修改密码                              |
| POST   | `/logout`         | 是   | 注销当前会话                          |
| DELETE | `/account`        | 是   | 注销账号（软删除）                    |
| GET    | `/sessions`       | 是   | 查看登录历史/活跃会话                 |
| GET    | `/quota`          | 是   | 查看配额使用情况                      |

#### 转换 `/api/v1/conversion`

| 方法   | 路径                              | 认证 | 说明                                          |
| ------ | --------------------------------- | ---- | --------------------------------------------- |
| POST   | `/upload`                         | 是   | 上传小说文件，创建转换任务                    |
| GET    | `/tasks`                          | 是   | 获取任务列表（支持 status/limit/offset 分页） |
| GET    | `/tasks/{id}`                     | 是   | 获取任务详情                                  |
| DELETE | `/tasks/{id}`                     | 是   | 删除任务及其关联数据                          |
| GET    | `/tasks/{id}/stream`              | 是   | SSE 进度推送（text/event-stream）             |
| GET    | `/tasks/{id}/screenplay`          | 是   | 获取转换完成的剧本数据                        |
| PUT    | `/tasks/{id}/screenplay`          | 是   | 保存编辑后的剧本 YAML                         |
| GET    | `/tasks/{id}/evaluation`          | 是   | 获取质量评估报告                              |
| GET    | `/tasks/{id}/yaml`                | 是   | 下载 YAML 文件                                |
| POST   | `/tasks/{id}/chat`                | 是   | AI 编剧对话（自然语言修改剧本）               |
| GET    | `/tasks/{id}/chat/history`        | 是   | 获取对话历史                                  |
| GET    | `/tasks/{id}/chat/session/export` | 是   | 导出对话记录（JSON/Markdown）                 |

#### 管理 `/api/v1/admin`

| 方法 | 路径                | 认证         | 说明                             |
| ---- | ------------------- | ------------ | -------------------------------- |
| GET  | `/stats`            | 是（管理员） | 系统统计（用户数/任务数/存储量） |
| GET  | `/users`            | 是（管理员） | 用户列表（支持搜索/分页）        |
| PUT  | `/users/{id}/quota` | 是（管理员） | 修改用户配额                     |
| PUT  | `/users/{id}/role`  | 是（管理员） | 修改用户角色                     |

#### 系统

| 方法 | 路径          | 认证 | 说明                                        |
| ---- | ------------- | ---- | ------------------------------------------- |
| GET  | `/api/health` | 否   | 健康检查（数据库 / Redis / Celery Workers） |

### SSE 事件类型

转换进度流 (`/tasks/{id}/stream`) 推送以下事件：

| 事件       | 数据                             | 触发时机                               |
| ---------- | -------------------------------- | -------------------------------------- |
| `progress` | `{progress, message, timestamp}` | 进度百分比 + 当前步骤描述              |
| `log`      | `{message, level, timestamp}`    | 各阶段的详细日志（info/warning/error） |
| `complete` | `{task_id, evaluation}`          | 转换完成，附带评估数据                 |
| `error`    | `{message, error_category}`      | 转换失败，附带错误分类和友好提示       |

## 剧本 YAML 结构

转换输出的 YAML 文件遵循标准剧本 Schema（详见 `docs/screenplay_schema.md`）：

```yaml
screenplay:
  meta:
    title: "作品标题"
    author: "原作者"
    language: zh
    total_acts: 3
    total_scenes: 42
    generated_by: deepseek-chat
    generated_at: "2026-01-15T10:30:00Z"

  characters:
    - id: char_001
      name: "主角名"
      role: protagonist         # protagonist | antagonist | supporting | minor
      aliases: ["别名1", "别名2"]
      gender: male
      age_range: "18-22"
      traits: ["勇敢", "正直", "冲动"]
      description: "外貌与背景简述"
      first_appearance_scene: 1
      relationships:
        - character_id: char_002
          relation: "挚友"
          description: "青梅竹马，共同出生入死"

  acts:
    - act_number: 1
      title: "风云初起"
      scenes:
        - scene_number: 1
          scene_heading: "INT. 大殿 - 日"
          location: "大殿内部"
          time_of_day: "日"
          characters_present: [char_001, char_002]
          summary: "主角初次登场，接受师门试炼任务"
          content:
            - type: action
              text: "阳光透过窗棂洒入大殿，尘埃在光束中缓缓浮动。"
            - type: dialogue
              character_id: char_001
              character_name: "主角名"
              text: "终于等到这一天了。"
              delivery: "低声自语，眼神坚定"
            - type: parenthetical
              text: "深吸一口气"
            - type: transition
              text: "CUT TO:"
            - type: note
              text: "此处为角色成长转折点，建议配合激昂配乐"
              severity: suggestion    # info | warning | suggestion

  evaluation:
    total_score: 87
    structure_score: 35              # 满分 40
    format_score: 27                 # 满分 30
    content_score: 25                # 满分 30
    summary: "剧本整体质量良好，场景划分清晰，对白提取准确..."
    warnings:
      - type: "missing_character"
        message: "场景 12 中出现的「路人甲」未在角色列表中"
        scene_number: 12
      - type: "empty_scene"
        message: "场景 15 内容较少，可能分析不完整"
        scene_number: 15
```

### Content 元素类型说明

| type            | 用途                   | 关键字段                                             |
| --------------- | ---------------------- | ---------------------------------------------------- |
| `action`        | 环境/动作/氛围描述     | `text`                                               |
| `dialogue`      | 角色对白或内心独白     | `character_id`, `character_name`, `text`, `delivery` |
| `parenthetical` | 表演指示（括号内说明） | `text`                                               |
| `transition`    | 转场指令               | `text`（如 "CUT TO:" "FADE OUT"）                    |
| `note`          | AI 分析备注/建议       | `text`, `severity`（info/warning/suggestion）        |

**注意**：`monologue`、`narration`、`sound` 等不是合法类型。内心独白一律使用 `dialogue` 类型，设置 `delivery: "内心独白"`。

## 项目结构

```
ai_novel_script_project/
├── main.py                         # CLI 入口（Typer 命令）
├── config.yaml                     # 主配置文件
├── config.example.yaml             # 配置模板（不含敏感信息）
├── requirements.txt                # Python 依赖
├── start_robust.bat                # Windows 一键启动
├── start_robust.sh                 # Linux/Mac 一键启动
├── README.md                       # 项目文档
│
├── src/                            # 核心转换引擎（CLI 和 Web 共用）
│   ├── schema.py                   # Pydantic 剧本数据模型 + YAML 解析/导出
│   ├── converter.py                # 转换流水线编排
│   ├── llm_client.py               # 多提供商 LLM 客户端（DeepSeek + Anthropic）
│   ├── evaluator.py                # 三维度质量评估器
│   ├── errors.py                   # 异常分类系统（6 类中文友好提示）
│   ├── utils.py                    # 文本清洗 / 章节检测 / 角色合并
│   └── parsers/
│       ├── __init__.py             # BaseParser + get_parser_for 工厂函数
│       ├── txt_parser.py           # TXT/Markdown 解析器
│       ├── docx_parser.py          # DOCX 解析器
│       ├── doc_parser.py           # DOC（旧版 Word）解析器
│       └── pdf_parser.py           # PDF 解析器（PyMuPDF）
│
├── backend/                        # FastAPI Web 后端
│   ├── main.py                     # FastAPI 应用入口 + CORS + 中间件
│   ├── config.py                   # 配置管理（config.yaml + N2S_ 环境变量）
│   ├── database.py                 # SQLAlchemy 数据库连接 + 会话管理
│   ├── celery_app.py               # Celery 应用定义 + Redis 配置
│   ├── tasks.py                    # Celery 异步任务（convert_novel）
│   ├── api/
│   │   ├── auth.py                 # 认证路由
│   │   ├── conversion.py           # 转换路由（上传/任务/SSE/剧本/聊天/导出）
│   │   └── admin.py                # 管理路由
│   ├── models/
│   │   ├── user.py                 # User / RefreshToken / LoginHistory / UserQuota
│   │   ├── task.py                 # ConversionTask
│   │   ├── screenplay.py           # ScreenplayRecord
│   │   └── chat.py                 # ChatSession / ChatMessage
│   ├── schemas/
│   │   ├── auth.py                 # 认证请求/响应 Schema
│   │   └── conversion.py           # 转换请求/响应 Schema
│   └── services/
│       ├── auth_service.py         # 认证业务逻辑
│       ├── conversion_service.py   # 转换编排 + 进度回调 + 评估 + COS 同步
│       ├── chat_service.py         # AI 聊天 + 上下文窗口管理 + YAML 自动修复
│       ├── cos_service.py          # 腾讯云 COS 对象存储客户端
│       ├── stream.py               # Redis Pub/Sub SSE 流
│       ├── llm_rate_limiter.py     # Redis 令牌桶速率控制（Lua 原子操作）
│       ├── quota_service.py        # 用户配额校验
│       └── memory_manager.py       # 聊天消息 Redis 缓存层
│
├── frontend/                       # React + TypeScript 前端
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts              # Vite 配置（代理 /api → :8000）
│   ├── tailwind.config.ts          # Tailwind CSS 配置
│   └── src/
│       ├── main.tsx                # React 入口
│       ├── api/                    # Axios HTTP 客户端 + API 函数
│       │   ├── client.ts           # Axios 实例（拦截器/令牌刷新）
│       │   ├── auth.ts             # 认证 API
│       │   └── conversion.ts       # 转换 API
│       ├── components/
│       │   ├── common/             # 通用组件
│       │   │   ├── ErrorBoundary.tsx
│       │   │   ├── ProgressBar.tsx
│       │   │   ├── Skeleton.tsx
│       │   │   └── Toast.tsx
│       │   ├── conversion/         # 转换业务组件
│       │   │   ├── FileUploader.tsx          # 文件上传 + 模板选择 + 自定义 Prompt
│       │   │   ├── SplitScreenplayPreview.tsx # 分屏剧本预览（场景树 + 详情）
│       │   │   ├── CharacterGraph.tsx         # 角色关系图（节点-连线）
│       │   │   ├── ChatSidebar.tsx            # AI 编剧助手侧边栏
│       │   │   ├── ScreenplayEditor.tsx       # YAML 源码编辑器
│       │   │   ├── ExportMenu.tsx             # 多格式导出菜单
│       │   │   └── EvaluationCharts.tsx       # 评估图表
│       │   └── layout/
│       │       ├── Navbar.tsx       # 导航栏（用户菜单/主题切换）
│       │       └── AppLayout.tsx    # 布局容器
│       ├── pages/
│       │   ├── LandingPage.tsx      # 产品落地页
│       │   ├── DashboardPage.tsx    # 任务列表页
│       │   ├── ConversionDetailPage.tsx  # 转换详情页（预览/编辑/聊天）
│       │   ├── SettingsPage.tsx     # 个人设置页
│       │   ├── LoginPage.tsx        # 登录页
│       │   ├── RegisterPage.tsx     # 注册页
│       │   └── AdminPage.tsx        # 管理后台页
│       ├── contexts/
│       │   ├── AuthContext.tsx      # 认证状态管理
│       │   ├── ThemeContext.tsx     # 主题管理
│       │   └── ToastContext.tsx     # Toast 通知管理
│       ├── types/
│       │   └── index.ts            # TypeScript 类型定义
│       └── utils/
│           ├── export.ts           # 客户端多格式导出（TXT/HTML/DOCX）
│           ├── screenplayToYaml.ts # ScreenplayData → YAML 序列化
│           ├── templates.ts        # Prompt 模板库
│           ├── yamlHighlighter.ts  # YAML 语法高亮
│           └── evaluationHelpers.ts # 评估数据格式化
│
├── docs/                           # 文档
│   ├── screenplay_schema.md        # 剧本 Schema 详细说明
│   └── evaluation_checklist.md     # 质量评估检查清单
│
├── tests/                          # 测试
│   └── test_converter.py           # 转换器集成测试
│
├── ceshi/                          # 测试/示例
│   ├── novel.md                    # 测试用 Markdown 小说
│   ├── novel.docx                  # 测试用 DOCX 小说
│   ├── novel.pdf                   # 测试用 PDF 小说
│   └── test_output.yaml            # 测试输出示例
│
├── examples/                       # 示例输出
└── data/                           # 本地开发数据库（SQLite）
```

## 常见问题

### 转换失败怎么办？

错误信息会包含**分类标签**和**中文友好提示**，帮助快速定位问题：

| 错误分类     | 常见原因                                   | 解决建议                            |
| ------------ | ------------------------------------------ | ----------------------------------- |
| `parse`      | PDF 为扫描版图片、文件损坏、编码不兼容     | 确认文件可复制文字，使用 UTF-8 编码 |
| `llm`        | API Key 错误、余额不足、429 频率限制、超时 | 检查配置和账户余额，降低并行数      |
| `assembly`   | 角色数过多、场景结构异常                   | 减小文件或使用 --no-llm 模式测试    |
| `validation` | LLM 返回了不符合 Schema 的数据             | 重试或调整 temperature 降低随机性   |
| `io`         | 磁盘空间不足、文件权限问题                 | 检查磁盘和文件权限                  |

### 转换速度太慢？

- 调整 `conversion.max_parallel_chapters` 增大并发数（注意 API 速率限制）
- 使用 `deepseek-chat` 模型（比 Claude 更快更便宜）
- 减小 `conversion.max_chunk_size` 降低单次调用数据量

### 剧本质量不满意？

- 上传时选择合适的 **Prompt 模板**（如玄幻小说选「热血战斗番」）
- 使用 **AI 编剧助手** 针对性地修改不合适的场景
- 调整 `llm.temperature`（降低 → 更稳定，提高 → 更有创意）
- 手写自定义 Prompt，加入特定的改编要求

### Redis 连接失败？

- 确认 Redis 服务已启动：`redis-cli ping` 应返回 `PONG`
- 检查 `config.yaml` 或环境变量中的 Redis 配置
- 开发环境可设置 `N2S_REDIS_ENABLED=false` 降级为内存模式（不推荐生产使用）

### Celery Worker 无法启动？

```bash
# Windows 必须使用 threads 线程池
celery -A backend.celery_app worker --pool=threads --concurrency=4 -Q conversion

# Linux/Mac 可使用 prefork 进程池（性能更好）
celery -A backend.celery_app worker --pool=prefork --concurrency=4 -Q conversion
```

## 开发指南

### 添加新的文件解析器

1. 在 `src/parsers/` 下创建 `xxx_parser.py`
2. 继承 `BaseParser` 并实现 `parse(file_path) -> Novel` 方法
3. 在 `src/parsers/__init__.py` 中注册 MIME 类型映射
4. 在 `requirements.txt` 中添加新依赖

### 添加新的 Prompt 模板

编辑 `frontend/src/utils/templates.ts`，在 `TEMPLATES` 数组中添加新条目：

```typescript
{
  id: 'my-template',
  name: '模板名称',
  category: '分类',
  description: '简短描述',
  icon: '🎯',
  features: ['特性1', '特性2'],
  prompt: `你是一位...（完整 Prompt 内容）`,
}
```

### 添加新的 LLM 提供商

1. 在 `src/llm_client.py` 的 `_validate_provider()` 中注册新提供商名称
2. 添加 `_call_xxx()` 方法实现 API 调用
3. 在 `chat()` 和 `analyze_chapter()` 方法中添加路由分支

### 运行测试

```bash
# 运行全部测试
pytest tests/ -v

# 运行特定测试
pytest tests/test_converter.py -v -k "test_chapter_detection"

# 带覆盖率
pytest tests/ --cov=src --cov-report=html
```

## 安全注意事项

- **生产环境必须修改** `N2S_JWT_SECRET` 为强随机字符串
- **不要在代码仓库中提交** `config.yaml`（已在 `.gitignore` 中排除，使用 `config.example.yaml` 作为模板）
- API Key 支持 `${ENV_VAR}` 环境变量引用，避免明文存储密钥
- 管理后台路由受 `admin_only` 权限守卫保护
- 用户数据按 `user_id` 隔离，确保多用户间数据不可互相访问
- 密码使用 bcrypt 哈希存储，不保存明文
- 注册/登录/密码重置等敏感端点使用 slowapi 速率限制，防止暴力破解

## 许可证

MIT License
