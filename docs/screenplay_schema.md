# 剧本 YAML Schema 文档

> 版本 1.0 | AI 小说转剧本工具

## 概述

本文档定义了一套用于结构化存储剧本（电影/电视剧本）的 YAML Schema。该 Schema 专为 AI 辅助改编场景设计——既保留标准剧本格式的核心要素，又引入适配 AI 工作流的特有字段。

## Schema 总览

```yaml
screenplay:
  meta:         # 元数据
  characters:   # 角色表
  acts:         # 幕 → 场 → 内容元素
```

以下逐板块说明。

---

## 1. meta — 元数据

```yaml
meta:
  title: "春日尽"                    # 剧本标题
  original_work: "春日尽"             # 原著名称
  original_author: "张三"             # 原著作者
  adapted_by: "AI Novel-to-Script v0.1.0"  # 改编者标识
  version: "0.1.0"                  # 剧本版本号
  created_at: "2026-06-05T14:30:00Z" # ISO 8601 时间戳
  language: "zh-CN"                 # BCP 47 语言标签
  total_acts: 3                     # 总幕数（自动统计）
  total_scenes: 24                  # 总场数（自动统计）
  source_file: "novel.txt"          # 源文件名
  notes:                            # 全局备注（可选）
    - "第 3 章对话较少，部分场景对白由 AI 推断生成"
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 剧本标题，可能与原著不同 |
| `original_work` | string | 否 | 原著名称 |
| `original_author` | string | 否 | 原著作者 |
| `adapted_by` | string | 是 | 改编者标识，含工具版本便于追溯 |
| `version` | string | 是 | 剧本版本，建议语义化版本号 |
| `created_at` | datetime | 是 | 生成时间，ISO 8601 格式 |
| `language` | string | 是 | 剧本语言 |
| `total_acts` | int | 是 | 幕的总数 |
| `total_scenes` | int | 是 | 场的总数 |
| `source_file` | string | 否 | 源文件路径 |
| `notes` | string[] | 否 | 改编过程中需要注意的全局事项 |

### 设计原因

- **`adapted_by` 记录工具版本**：AI 辅助改编中，不同版本的工具可能产生不同质量的输出，记录版本便于复现和追责。
- **`source_file`**：支持多文件输入场景（如分章节文件），便于追溯原文。
- **`notes` 放在 meta 层面**：全局性改编备注（如"某角色对白推测较多"）应在剧本顶层可见，而非埋在具体场次中。

---

## 2. characters — 角色表

```yaml
characters:
  - id: "char_001"                    # 唯一标识
    name: "林晓"                       # 角色名
    aliases: ["晓晓", "小林"]          # 别名/昵称/化名
    role: "protagonist"               # protagonist | antagonist | supporting | minor
    gender: "female"                  # male | female | other | unknown
    age_range: "25-30"                # 年龄段
    traits:                           # 性格特征
      - "内向敏感"
      - "执着"
      - "音乐天赋"
    description: |                    # 外貌与背景描述
      25岁小提琴手，长发，常穿素色衣服。
      父母离异，独自在城市生活。
    relationships:                    # 角色关系
      - character_id: "char_002"
        relation: "恋人"
        description: "大学时期相识，因家庭原因分手"
      - character_id: "char_003"
        relation: "导师"
        description: "音乐学院教授，对林晓要求严苛"
    first_appearance_scene: 3         # 首次出场场次
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 全局唯一标识，格式 `char_NNN` |
| `name` | string | 是 | 角色主要名称 |
| `aliases` | string[] | 否 | 别名、昵称、化名、外号等 |
| `role` | enum | 是 | 角色类型 |
| `gender` | enum | 否 | 性别 |
| `age_range` | string | 否 | 年龄段，如 "25-30" / "中年" / "老年" |
| `traits` | string[] | 否 | 性格特征关键词/短语 |
| `description` | string | 否 | 外貌、背景、动机等多句描述 |
| `relationships` | object[] | 否 | 与其他角色的关系列表 |
| `relationships[].character_id` | string | 是 | 关联角色的 ID |
| `relationships[].relation` | string | 是 | 关系类型（父子/恋人/师徒等） |
| `relationships[].description` | string | 否 | 关系详情 |
| `first_appearance_scene` | int | 否 | 角色首次出场的场景编号 |

### 设计原因

- **`id` 而非依赖 `name`**：小说中角色常有别名、化名、称呼变化（"林晓"/"晓晓"/"林小姐"）。用 ID 作为唯一标识，避免 NLP 指代消解的不确定性传播到剧本中。所有对白和场景中的角色引用均使用 ID。

- **`aliases`**：直接列出别名供解析器和人工校对使用，无需二次推断。

- **`role` 限定四种类型**：protagonist（主角）、antagonist（对手/反派）、supporting（配角）、minor（次要角色）。分类够用但不繁琐——太细（如"mentor"/"herald"等 Campbell 原型）可能引发 AI 分类争议。

- **`relationships` 嵌入角色定义**：相比于单独的关系表，内嵌更直观。修改角色时不会遗漏关系更新。剧本改编中角色关系是核心信息，应紧贴角色定义。

- **`first_appearance_scene`**：对选角和角色弧规划极有价值。AI 提取时即可填充，避免人工事后翻找。

---

## 3. acts — 幕/场景结构

```yaml
acts:
  - act_number: 1
    title: "第一幕"                    # 可选幕标题
    scenes:
      - scene_number: 1              # 全局场次编号
        scene_heading: "INT. 林晓的公寓 - 日"  # slugline
        location: "林晓的公寓"
        time_of_day: "日"
        characters_present:          # 本场出现的角色
          - "char_001"
          - "char_003"
        summary: "林晓在公寓练琴，收到音乐学院复试通知"
        content:                     # 内容元素列表（见第 4 节）
          - ...
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `act_number` | int | 是 | 幕序号，从 1 开始 |
| `title` | string | 否 | 幕标题，如"第一幕：相遇" |
| `scenes` | object[] | 是 | 该幕包含的场景列表 |
| `scenes[].scene_number` | int | 是 | 全局唯一场次编号 |
| `scenes[].scene_heading` | string | 是 | 场标/slugline（好莱坞标准格式） |
| `scenes[].location` | string | 是 | 地点描述 |
| `scenes[].time_of_day` | string | 是 | 时间：日/夜/傍晚/凌晨/晨 |
| `scenes[].characters_present` | string[] | 是 | 本场出现角色 ID 列表 |
| `scenes[].summary` | string | 否 | 本场内容一句话概要 |
| `scenes[].content` | object[] | 是 | 本场的内容元素列表 |

### 设计原因

- **`act_number` + `scene_number`**：幕用 1-based 序号，场用全局唯一编号。这种"幕—场"双层编号避免了"第 2 幕第 3 场"的歧义，也方便跨幕引用。

- **`scene_heading` (slugline)**：遵循好莱坞标准格式 `INT./EXT. 地点 - 时间`。这是剧本行业的通用语言，制片、导演、美术一看就懂。AI 从小说叙事中推断室内/室外、时间段是可行的。

- **`characters_present`**：放在场级别而非嵌在 content 里，让选角导演和场记可以快速扫描哪些角色出现在哪些场，无需逐行解析 content。

- **`summary`**：一句话概要不是冗余——编剧翻看场景列表时比阅读完整内容快一个数量级，也方便 AI 生成目录式的场景索引。

---

## 4. content — 内容元素

每场由一系列有序的元素构成。共有五种元素类型：

### 4.1 action — 动作/描述

```yaml
- type: "action"
  text: "阳光透过半开的窗帘洒在旧地板上。林晓站在窗前，手指轻轻敲着窗台。"
```

小说中大量的环境描写、人物动作、心理描述都映射为 `action` 元素。

### 4.2 dialogue — 对白

```yaml
- type: "dialogue"
  character_id: "char_001"
  character_name: "林晓"         # 冗余字段，方便直接阅读
  text: "我不会放弃的。"
  delivery: "轻声但坚定"         # 可选
```

### 4.3 parenthetical — 表演指示

```yaml
- type: "parenthetical"
  text: "看向窗外"               # 在好莱坞剧本中是对白下方的括号内容
```

`parenthetical` 与 `dialogue` 分离而非嵌套，因为一个表演指示可能对应一组对话，且它本身是一个独立的中文/英文片段。

### 4.4 transition — 转场

```yaml
- type: "transition"
  text: "CUT TO:"
```

标准转场标记，AI 根据小说中的场景跳转判断。

### 4.5 note — 改编备注

```yaml
- type: "note"
  text: "原著此处有大量内心独白，建议由导演与演员讨论如何视觉化呈现"
  severity: "suggestion"          # info | warning | suggestion
```

### 设计原因

- **五种类型的划分逻辑**：前三者（action / dialogue / parenthetical）直接对应好莱坞标准剧本格式的三要素：动作行、角色对白行、括号指示行。`transition` 是编辑/后期阶段的关键标记。`note` 是 **AI 改编独有的**——承认模型可能在复杂段落（内心独白、模糊对话归属、非线性叙事）上出错或给不出最优方案，通过显式标记降低误导风险。

- **`dialogue.character_name` 冗余设计**：用 `character_id` 确保机器可处理；同时冗余 `character_name`，使人眼直接阅读 YAML 时无需跳回角色表查找。Schema 校验时应确保两者一致。

- **`delivery` 字段**：让 AI 从"他愤怒地说""她低声呢喃"等对话标签中提取语气信息，比纯文本更具导演指导价值。

- **`note.severity` 分级**：
  - `info`：事实性提示（"此处为原著第 45 页的内容"）
  - `warning`：可能的错误（"对话归属不确定，可能是李四说的"）
  - `suggestion`：改进建议（"建议在此加入一个闪回场景"）

- **`parenthetical` 独立于 `dialogue`**：在标准剧本中，括号指示放在角色名和对白之间。但实际工作中，导演可能先浏览所有舞台指示，再精读对白。将两者分离为同级元素，方便按需筛选。

---

## 5. 完整示例

参见 `examples/sample_output.yaml`。

---

## 6. Schema 校验规则

1. 所有 `character_id` 引用必须在 `characters` 列表中定义
2. `characters_present` 中的角色必须在 `characters` 中声明
3. `scene_number` 必须全局唯一且连续递增
4. `meta.total_acts`、`meta.total_scenes` 必须与实际结构一致
5. `dialogue.character_name` 必须与对应 `character_id` 的 `name` 或 `aliases` 之一匹配
6. `relationships[].character_id` 必须引用已存在的角色
7. `content` 列表不能为空
8. `time_of_day` 建议使用标准值：日 / 夜 / 傍晚 / 凌晨 / 晨 / 下午 / 黄昏

---

## 7. 版本演进

当前版本（1.0）聚焦剧本初稿阶段。未来可能扩展的字段：

- **shot / camera 信息**：机位、景别（特写/全景等），适合拍摄阶段而非改编阶段
- **timing / duration**：场景预估时长，适合制片统筹
- **props / costumes**：道具与服装列表
- **music / sfx**：配乐与音效标记

这些字段暂时不纳入 1.0，以保持初稿 Schema 的聚焦和简洁。
