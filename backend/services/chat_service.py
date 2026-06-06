"""AI chat assistant service — natural language screenplay editing via LLM with persistence."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy.orm import Session

from src.llm_client import LLMClient
from src.schema import ScreenplayYAML

from ..config import settings
from ..models.chat import ChatSession, ChatMessage
from . import memory_manager as memory

logger = logging.getLogger(__name__)

MAX_CONTEXT_MESSAGES = 12

# ---------------------------------------------------------------------------
# Token 估算
# ---------------------------------------------------------------------------

def estimate_tokens(text: str) -> int:
    """粗略估算文本的 token 数。中文按字符数，英文按单词数×1.3。"""
    if not text:
        return 0
    chinese_chars = sum(1 for c in text if '一' <= c <= '鿿')
    english_words = len(re.findall(r'[a-zA-Z]+', text))
    others = len(text) - chinese_chars - sum(len(w) for w in re.findall(r'[a-zA-Z]+', text))
    return chinese_chars + int(english_words * 1.3) + max(0, others // 2)

CHAT_SYSTEM_PROMPT = """你是一个专业的剧本编辑 AI 助手。用户会用自然语言描述想要的修改，你需要理解意图并返回修改后的完整 YAML。

## 剧本 YAML 结构说明

```yaml
screenplay:
  meta:
    title: "剧本标题"
    original_work: null
    original_author: null
    total_acts: 3
    total_scenes: 10
    language: zh-CN
    notes: []
    # ... 其他元数据字段
  characters:
  - id: char_001
    name: "角色名"
    aliases: []
    role: protagonist  # protagonist / antagonist / supporting / minor
    gender: male  # male / female / other / unknown
    age_range: null
    traits: []
    description: null
    relationships:
    - character_id: char_002
      relation: "朋友"
      description: null
    first_appearance_scene: null
  acts:
  - act_number: 1
    title: "第一幕"
    scenes:
    - scene_number: 1
      scene_heading: "场景标题（英文大写）"
      location: "地点描述"
      time_of_day: "日"
      characters_present: [char_001, char_002]
      summary: null
      content:
      - type: action
        text: "动作/场景描述"
      - type: dialogue
        character_id: char_001
        character_name: "角色名"
        text: "对白内容"
        delivery: null  # 可选：语气指示
      - type: parenthetical
        text: "表演指示"
      - type: transition
        text: "CUT TO:"
      - type: note
        text: "改编备注"
        severity: info  # info / warning / suggestion
```

## 重要规则

1. 你必须返回包含完整 screenplay YAML 的 JSON 对象，格式如下：
```json
{
  "modified_yaml": "screenplay:\\n  meta:\\n    ...",
  "change_summary": "简短描述你做了什么修改",
  "changes": [
    {"type": "modify", "target": "第二幕场景4 萧炎的台词", "description": "将台词语气改得更加愤怒"},
    {"type": "add", "target": "第二幕新增场景", "description": "在第二幕后添加萧媚心理活动过场戏"}
  ]
}
```

2. modified_yaml 必须是完整有效的 YAML 字符串（包含 screenplay: 顶级键）
3. 保持所有未修改的部分原样不变
4. 新增场景需要分配正确的 scene_number（全局递增）
5. 新增角色需要分配唯一的 id（格式 char_NNN）
6. 更新 meta.total_scenes 和 meta.total_acts 以匹配实际结构
7. 对白修改要保持 character_id 与 characters 列表一致
8. scene_number 必须全局唯一且连续（1, 2, 3, ...）
"""


# ---------------------------------------------------------------------------
# Session management
# ---------------------------------------------------------------------------

def get_or_create_session(db: Session, user_id: int, task_id: int) -> ChatSession:
    """获取已有对话 session，或新建一个（1 任务 = 1 会话）。"""
    session = db.query(ChatSession).filter(
        ChatSession.user_id == user_id,
        ChatSession.task_id == task_id,
    ).first()
    if session:
        return session

    # 从任务名称自动生成标题
    from ..models.task import ConversionTask
    task = db.query(ConversionTask).filter(ConversionTask.id == task_id).first()
    title = None
    if task:
        title = f"讨论 {task.original_filename}" if task.original_filename else None

    session = ChatSession(
        user_id=user_id,
        task_id=task_id,
        title=title,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # 缓存 session 元数据
    memory.cache_session_meta(session.id, {
        "session_id": session.id,
        "user_id": session.user_id,
        "task_id": session.task_id,
        "title": session.title,
        "message_count": session.message_count,
    })

    return session


def save_user_message(db: Session, session_id: int, content: str) -> ChatMessage:
    """持久化用户消息，同步写入 Redis 缓存。自动生成标题（首条消息）。"""
    token_count = estimate_tokens(content)
    msg = ChatMessage(session_id=session_id, role="user", content=content, token_count=token_count)
    db.add(msg)

    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session:
        session.message_count = (session.message_count or 0) + 1
        # 自动标题：首条用户消息截取前 20 字（覆盖默认标题）
        if session.message_count == 1:
            title = content.strip()[:20]
            session.title = (title + "...") if len(content.strip()) > 20 else title

    db.commit()
    db.refresh(msg)

    # Redis 缓存：追加消息 + 更新 meta
    memory.append_cached_message(session_id, memory.message_to_dict(msg))
    if session:
        memory.cache_session_meta(session_id, {
            "session_id": session.id, "user_id": session.user_id,
            "task_id": session.task_id, "title": session.title,
            "message_count": session.message_count,
        })

    return msg


def save_assistant_message(
    db: Session,
    session_id: int,
    content: str,
    modified_yaml: str | None = None,
    change_summary: str | None = None,
    changes: list[dict] | None = None,
) -> ChatMessage:
    """持久化 AI 回复，同步写入 Redis 缓存。"""
    token_count = estimate_tokens(content) + estimate_tokens(modified_yaml or "")
    msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=content,
        modified_yaml=modified_yaml,
        change_summary=change_summary,
        changes_json=json.dumps(changes, ensure_ascii=False) if changes else None,
        token_count=token_count,
    )
    db.add(msg)

    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session:
        session.message_count = (session.message_count or 0) + 1

    db.commit()
    db.refresh(msg)

    # Redis 缓存：追加消息
    memory.append_cached_message(session_id, memory.message_to_dict(msg))

    return msg


def get_recent_messages(db: Session, session_id: int, limit: int = MAX_CONTEXT_MESSAGES) -> list[ChatMessage]:
    """加载最近 N 条消息 —— Redis 优先，miss 时回退到 DB 并回填缓存。"""
    # 1) 尝试 Redis
    cached = memory.get_cached_messages(session_id)
    if cached:
        # 只取最近 N 条，按 created_at 排序
        cached = cached[-limit:]
        # 将字典转为 ChatMessage 对象（简化版，只填充必要字段）
        result: list[ChatMessage] = []
        for item in cached:
            m = ChatMessage()
            m.id = item.get("id", 0)
            m.role = item.get("role", "")
            m.content = item.get("content", "")
            m.change_summary = item.get("change_summary")
            m.changes_json = item.get("changes_json")
            m.accepted = item.get("accepted")
            m.rejected = item.get("rejected")
            result.append(m)
        return result

    # 2) 回退到 DB
    db_msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )[::-1]

    # 3) 回填 Redis
    if db_msgs:
        memory.cache_messages(session_id, [memory.message_to_dict(m) for m in db_msgs])

    return db_msgs


def get_all_messages(db: Session, session_id: int) -> list[ChatMessage]:
    """加载全部消息（用于历史展示），直接查 DB。"""
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )


def delete_session(db: Session, session_id: int) -> None:
    """删除对话 session 及所有消息，同时清除 Redis 缓存。"""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session:
        db.delete(session)
        db.commit()

    # 清除 Redis 缓存
    memory.invalidate_session(session_id)


# ---------------------------------------------------------------------------
# Context building
# ---------------------------------------------------------------------------

def build_context(messages: list[ChatMessage]) -> str:
    """将消息历史构建为 LLM 可理解的上下文字符串。

    - 最近 12 条消息保留完整内容
    - 超出窗口的旧消息提供一行摘要，节省 token
    - AI 消息只保留 change_summary，不包含完整 YAML
    """
    if not messages:
        return ""

    max_n = MAX_CONTEXT_MESSAGES
    overflow = messages[:-max_n] if len(messages) > max_n else []
    recent = messages[-max_n:]

    lines = ["## 对话历史\n"]

    # 超窗消息摘要化
    if overflow:
        user_count = sum(1 for m in overflow if m.role == "user")
        ai_count = sum(1 for m in overflow if m.role == "assistant")
        last_summary = ""
        for m in reversed(overflow):
            if m.role == "assistant" and m.change_summary:
                last_summary = m.change_summary
                break
        summary_parts = [f"省略了较早的 {len(overflow)} 条消息"]
        if user_count > 0:
            summary_parts.append(f"（{user_count} 条用户指令")
        if ai_count > 0:
            summary_parts.append(f"{ai_count} 条 AI 修改）")
        if last_summary:
            summary_parts.append(f"，最近一次修改: {last_summary}")
        lines.append(" ".join(summary_parts) + "\n")

    for msg in recent:
        if msg.role == "user":
            lines.append(f"用户: {msg.content}")
        elif msg.role == "assistant":
            summary = msg.change_summary or (msg.content[:100] if msg.content else "")
            lines.append(f"AI 助手: [修改] {summary}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Chat edit — main entry point
# ---------------------------------------------------------------------------

async def chat_edit(
    current_yaml: str,
    instruction: str,
    db: Session | None = None,
    user_id: int | None = None,
    task_id: int | None = None,
    session_id: int | None = None,
    conversation_history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Send a natural language editing instruction to the LLM and get modified YAML back.

    If db + user_id + task_id are provided, messages are persisted to the database.
    Context is built from DB messages (with fallback to conversation_history param).
    """
    # Resolve session from DB if available
    session: ChatSession | None = None
    db_messages: list[ChatMessage] = []

    if db and user_id and task_id is not None:
        if session_id:
            session = db.query(ChatSession).filter(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
            ).first()
        if not session:
            session = get_or_create_session(db, user_id, task_id)
        session_id = session.id

        # Save user message
        save_user_message(db, session.id, instruction)

        # Load recent messages for context
        db_messages = get_recent_messages(db, session.id, limit=MAX_CONTEXT_MESSAGES)

    # Build LLM prompt
    llm = LLMClient(settings.config_path)

    # Build context from DB messages (preferred) or fallback to conversation_history param
    context_str = ""
    if db_messages:
        context_str = build_context(db_messages)
    elif conversation_history:
        context_str = build_context_from_history(conversation_history)

    user_prompt = f"""## 当前剧本 YAML

```yaml
{current_yaml}
```

## 用户指令

{instruction}"""

    if context_str:
        user_prompt = context_str + "\n---\n\n" + user_prompt

    raw = await _run_in_thread(llm.chat, CHAT_SYSTEM_PROMPT, user_prompt)
    result = _parse_chat_response(raw)

    # Save assistant message to DB
    if db and session:
        save_assistant_message(
            db,
            session.id,
            content=result["change_summary"],
            modified_yaml=result["modified_yaml"],
            change_summary=result["change_summary"],
            changes=result.get("changes", []),
        )

    result["session_id"] = session_id
    return result


def build_context_from_history(history: list[dict[str, str]]) -> str:
    """Build context from the old conversation_history format (fallback)."""
    if not history:
        return ""
    lines = ["## 对话历史\n"]
    for msg in history[-MAX_CONTEXT_MESSAGES:]:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            lines.append(f"用户: {content}")
        else:
            lines.append(f"AI 助手: [修改] {content}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

async def _run_in_thread(func, *args):
    """Run a sync function in a thread to avoid blocking the event loop."""
    import asyncio
    return await asyncio.to_thread(func, *args)


def _parse_chat_response(raw: str) -> dict[str, Any]:
    """Parse the LLM's JSON response, extracting modified_yaml and change info."""
    json_str = raw.strip()

    json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', raw, re.DOTALL)
    if json_match:
        json_str = json_match.group(1).strip()

    try:
        result = json.loads(json_str)
    except json.JSONDecodeError:
        yaml_match = re.search(r'(screenplay:.*)', raw, re.DOTALL)
        if yaml_match:
            yaml_content = yaml_match.group(1).strip()
            try:
                ScreenplayYAML.parse_yaml(yaml_content)
                return {
                    "modified_yaml": yaml_content,
                    "change_summary": "根据指令修改了剧本（从 LLM 响应中提取 YAML）",
                    "changes": [],
                }
            except Exception:
                pass
        raise ValueError(f"无法解析 AI 响应: {raw[:300]}...")

    if "modified_yaml" not in result:
        raise ValueError("AI 响应缺少 modified_yaml 字段")

    try:
        ScreenplayYAML.parse_yaml(result["modified_yaml"])
    except Exception as e:
        logger.warning("LLM returned invalid YAML: %s", e)
        raise ValueError(f"AI 返回的 YAML 格式无效: {e}")

    return {
        "modified_yaml": result["modified_yaml"],
        "change_summary": result.get("change_summary", ""),
        "changes": result.get("changes", []),
    }
