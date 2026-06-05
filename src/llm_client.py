"""Multi-provider LLM client for novel chapter analysis.

Supports: Anthropic Claude API, DeepSeek (OpenAI-compatible) API.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Optional

import yaml

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes for LLM responses
# ---------------------------------------------------------------------------

@dataclass
class ExtractedCharacter:
    name: str
    role: str
    aliases: list[str] = field(default_factory=list)
    gender: str = "unknown"
    age_range: str = ""
    traits: list[str] = field(default_factory=list)
    description: str = ""
    relationships: list[dict] = field(default_factory=list)
    first_appearance_scene: Optional[int] = None


@dataclass
class SceneContent:
    type: str
    text: str
    character_id: str = ""
    character_name: str = ""
    delivery: Optional[str] = None
    severity: str = "info"


@dataclass
class ExtractedScene:
    scene_heading: str
    location: str
    time_of_day: str
    summary: str
    characters_present: list[str] = field(default_factory=list)
    content: list[SceneContent] = field(default_factory=list)


@dataclass
class ChapterAnalysis:
    chapter_number: int
    chapter_title: str
    characters: list[ExtractedCharacter] = field(default_factory=list)
    scenes: list[ExtractedScene] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

JSON_FORMAT_SPEC = """
## 输出格式

你必须严格按照以下 JSON 格式返回（不要包含 markdown 代码块标记）：

{{
  "chapter_title": "章节标题",
  "characters": [
    {{
      "name": "角色名",
      "role": "protagonist|antagonist|supporting|minor",
      "aliases": ["别名1", "别名2"],
      "gender": "male|female|other|unknown",
      "age_range": "25-30",
      "traits": ["特征1", "特征2"],
      "description": "外貌与背景简述",
      "relationships": [
        {{"character_name": "关联角色名", "relation": "关系", "description": "关系简述"}}
      ]
    }}
  ],
  "scenes": [
    {{
      "scene_heading": "INT./EXT. 地点 - 时间",
      "location": "具体地点",
      "time_of_day": "日|夜|傍晚|凌晨|晨|下午|黄昏",
      "summary": "本场一句话概要",
      "characters_present": ["出现的角色名"],
      "content": [
        {{"type": "action", "text": "环境或动作描述"}},
        {{"type": "dialogue", "character_name": "说话角色名", "text": "对白内容", "delivery": "语气(可选)"}},
        {{"type": "parenthetical", "text": "表演指示"}},
        {{"type": "transition", "text": "CUT TO:"}},
        {{"type": "note", "text": "AI备注", "severity": "info|warning|suggestion"}}
      ]
    }}
  ],
  "notes": ["本章改编的整体备注"]
}}

## 关键规则

1. **角色提取**：每个出场角色都要记录，包括别名。role 字段：protagonist=主角, antagonist=对手/反派, supporting=重要配角, minor=龙套。
2. **场景划分**：每当时间、地点发生明显变化时，开新场景。场景按叙事顺序排列。
3. **scene_heading**：使用好莱坞标准格式 "INT./EXT. 地点 - 时间"。依据文本描述判断室内(INT.)还是室外(EXT.)。
4. **对白识别**：将引导号内的对话和叙述中的直接引语都提取为 dialogue 元素。尽可能标注 delivery 语气。
5. **内心独白处理**：角色的内心独白也标注为 dialogue，但在 delivery 中注明"内心独白"。同时添加一个 note 元素，建议导演考虑视觉化呈现方式。
6. **不确定时用 note**：对话归属不明确、场景边界模糊、角色身份不确定时，添加 note 元素标注。
7. **关系提取**：从叙事中提取角色之间的关系，使用角色名（而非 ID）引用。
8. **语言**：所有输出使用与输入文本相同的语言（中文输入→中文输出）。

## 已识别角色（上下文）

{character_context}

请在分析本章时复用上述角色的名称。如果本章出现新角色，添加到输出中。如果已有角色的别名在本章首次出现，添加到该角色的 aliases 中。"""

SYSTEM_PROMPT = """你是一位资深的剧本分析师和编剧，擅长将小说文本改编为标准剧本格式。

你的任务：分析给定的章节文本，将其拆解为结构化的剧本元素。

""" + JSON_FORMAT_SPEC


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class LLMClient:
    """Multi-provider LLM client for chapter-to-script analysis.

    Supports:
    - anthropic: Anthropic Claude API (via anthropic SDK)
    - deepseek: DeepSeek API (OpenAI-compatible, via openai SDK)
    """

    def __init__(self, config_path: str = "config.yaml"):
        self.config = self._load_config(config_path)
        llm_cfg = self.config.get("llm", {})

        self.provider = llm_cfg.get("provider", "anthropic")
        self.model = llm_cfg.get("model", "deepseek-chat")
        self.max_tokens = int(llm_cfg.get("max_tokens", 8192))
        self.temperature = float(llm_cfg.get("temperature", 0.3))
        self.base_url = llm_cfg.get("base_url", "https://api.deepseek.com")
        self.api_key = self._resolve_api_key(llm_cfg)

        self._validate_provider()

    @staticmethod
    def _resolve_api_key(llm_cfg: dict) -> str:
        key = llm_cfg.get("api_key", "")
        if key.startswith("${") and key.endswith("}"):
            env_var = key[2:-1]
            key = os.environ.get(env_var, "")
        if not key:
            raise ValueError(
                "LLM API key not found. Set the appropriate environment variable "
                "(DEEPSEEK_API_KEY or ANTHROPIC_API_KEY) or specify api_key in config.yaml"
            )
        return key

    def _validate_provider(self) -> None:
        valid = {"anthropic", "deepseek"}
        if self.provider not in valid:
            raise ValueError(f"Unknown provider '{self.provider}'. Supported: {valid}")

    @staticmethod
    def _load_config(path: str) -> dict:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def _build_character_context(self, known_characters: list[dict]) -> str:
        if not known_characters:
            return "（尚无已识别角色）"
        lines = []
        for c in known_characters:
            aliases_str = "、".join(c.get("aliases", []))
            lines.append(
                f"- {c['name']}"
                + (f"（别名：{aliases_str}）" if aliases_str else "")
                + f" | {c.get('role', 'unknown')}"
                + (f" | {c.get('description', '')[:60]}" if c.get("description") else "")
            )
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def chat(self, system_prompt: str, user_prompt: str) -> str:
        """Generic chat completion — send a system + user prompt and get the raw response."""
        if self.provider == "anthropic":
            return self._call_anthropic(system_prompt, user_prompt)
        elif self.provider == "deepseek":
            return self._call_deepseek(system_prompt, user_prompt)
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

    def analyze_chapter(
        self,
        chapter_number: int,
        chapter_title: str,
        chapter_text: str,
        known_characters: Optional[list[dict]] = None,
    ) -> ChapterAnalysis:
        char_ctx = self._build_character_context(known_characters or [])
        custom = getattr(self, 'custom_system_prompt', None)
        if custom:
            base_prompt = custom + "\n\n" + JSON_FORMAT_SPEC
        else:
            base_prompt = SYSTEM_PROMPT
        system_prompt = base_prompt.format(character_context=char_ctx)

        user_prompt = (
            f"## 第 {chapter_number} 章：{chapter_title}\n\n{chapter_text}\n\n"
            f"请按照 JSON 格式输出本章的剧本分析结果。"
        )

        if self.provider == "anthropic":
            raw = self._call_anthropic(system_prompt, user_prompt)
        elif self.provider == "deepseek":
            raw = self._call_deepseek(system_prompt, user_prompt)
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

        return self._parse_response(raw, chapter_number, chapter_title)

    # ------------------------------------------------------------------
    # Provider backends
    # ------------------------------------------------------------------

    def _call_anthropic(self, system_prompt: str, user_prompt: str, max_retries: int = 3) -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=self.api_key)

        last_error = None
        for attempt in range(max_retries):
            try:
                message = client.messages.create(
                    model=self.model,
                    max_tokens=self.max_tokens,
                    temperature=self.temperature,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_prompt}],
                )
                for block in message.content:
                    if hasattr(block, "text"):
                        return block.text
                raise ValueError("No text block in Anthropic response")

            except (anthropic.APIError, anthropic.APIConnectionError) as e:
                last_error = e
                wait = 2 ** attempt
                logger.warning("Anthropic call attempt %d failed: %s. Retrying in %ds...", attempt + 1, e, wait)
                if attempt < max_retries - 1:
                    import time
                    time.sleep(wait)

        raise RuntimeError(f"Anthropic API call failed after {max_retries} retries: {last_error}")

    def _call_deepseek(self, system_prompt: str, user_prompt: str, max_retries: int = 3) -> str:
        from openai import OpenAI
        client = OpenAI(api_key=self.api_key, base_url=self.base_url)

        last_error = None
        for attempt in range(max_retries):
            try:
                response = client.chat.completions.create(
                    model=self.model,
                    max_tokens=self.max_tokens,
                    temperature=self.temperature,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                )
                content = response.choices[0].message.content
                if content is None:
                    raise ValueError("Empty response from DeepSeek")
                return content

            except Exception as e:
                last_error = e
                wait = 2 ** attempt
                logger.warning("DeepSeek call attempt %d failed: %s. Retrying in %ds...", attempt + 1, e, wait)
                if attempt < max_retries - 1:
                    import time
                    time.sleep(wait)

        raise RuntimeError(f"DeepSeek API call failed after {max_retries} retries: {last_error}")

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_json(text: str) -> str:
        text = text.strip()
        fence_pattern = r"^```(?:json)?\s*\n(.*?)\n```"
        match = re.search(fence_pattern, text, re.DOTALL)
        if match:
            text = match.group(1).strip()
        return text

    def _parse_response(
        self,
        raw_text: str,
        chapter_number: int,
        chapter_title: str,
    ) -> ChapterAnalysis:
        json_text = self._strip_json(raw_text)
        try:
            data = json.loads(json_text)
        except json.JSONDecodeError as e:
            # Save failed response for debugging
            debug_path = f"debug_response_ch{chapter_number}.txt"
            with open(debug_path, "w", encoding="utf-8") as f:
                f.write(f"--- RAW RESPONSE ---\n{raw_text}\n\n--- STRIPPED JSON ---\n{json_text}")
            logger.error(
                "Failed to parse LLM JSON for chapter %d. Saved to %s. Error: %s",
                chapter_number, debug_path, e,
            )
            raise ValueError(f"LLM returned invalid JSON (saved to {debug_path}): {e}") from e

        characters = [
            ExtractedCharacter(
                name=c["name"],
                role=c.get("role", "minor"),
                aliases=c.get("aliases", []),
                gender=c.get("gender", "unknown"),
                age_range=c.get("age_range", ""),
                traits=c.get("traits", []),
                description=c.get("description", ""),
                relationships=c.get("relationships", []),
                first_appearance_scene=None,
            )
            for c in data.get("characters", [])
        ]

        scenes = []
        for s in data.get("scenes", []):
            content = [
                SceneContent(
                    type=e["type"],
                    text=e.get("text", ""),
                    character_id="",
                    character_name=e.get("character_name", ""),
                    delivery=e.get("delivery"),
                    severity=e.get("severity", "info"),
                )
                for e in s.get("content", [])
            ]
            scenes.append(ExtractedScene(
                scene_heading=s.get("scene_heading", ""),
                location=s.get("location", ""),
                time_of_day=s.get("time_of_day", "日"),
                summary=s.get("summary", ""),
                characters_present=s.get("characters_present", []),
                content=content,
            ))

        notes = data.get("notes", [])

        return ChapterAnalysis(
            chapter_number=chapter_number,
            chapter_title=chapter_title or data.get("chapter_title", f"第{chapter_number}章"),
            characters=characters,
            scenes=scenes,
            notes=notes,
        )
