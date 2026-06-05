"""Pydantic models for the screenplay YAML schema."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Union, Annotated, Optional

from pydantic import (
    BaseModel,
    Field,
    field_validator,
    model_validator,
    ValidationInfo,
)
import yaml


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class CharacterRole(str, Enum):
    PROTAGONIST = "protagonist"
    ANTAGONIST = "antagonist"
    SUPPORTING = "supporting"
    MINOR = "minor"


class Gender(str, Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"
    UNKNOWN = "unknown"


class TimeOfDay(str, Enum):
    DAWN = "晨"
    MORNING = "上午"
    NOON = "日"
    AFTERNOON = "下午"
    DUSK = "傍晚"
    EVENING = "黄昏"
    NIGHT = "夜"
    MIDNIGHT = "凌晨"


class NoteSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    SUGGESTION = "suggestion"


# ---------------------------------------------------------------------------
# Content Elements (discriminated union on "type")
# ---------------------------------------------------------------------------

class ActionElement(BaseModel):
    type: Literal["action"] = "action"
    text: str = Field(..., description="动作或场景描述文本")


class DialogueElement(BaseModel):
    type: Literal["dialogue"] = "dialogue"
    character_id: str = Field(..., description="说话角色的 ID")
    character_name: str = Field(..., description="角色名，冗余字段便于阅读")
    text: str = Field(..., description="对白内容")
    delivery: Optional[str] = Field(None, description="语气或表演指示")


class ParentheticalElement(BaseModel):
    type: Literal["parenthetical"] = "parenthetical"
    text: str = Field(..., description="表演指示内容")


class TransitionElement(BaseModel):
    type: Literal["transition"] = "transition"
    text: str = Field(..., description="转场文本，如 CUT TO: / FADE IN:")


class NoteElement(BaseModel):
    type: Literal["note"] = "note"
    text: str = Field(..., description="AI 改编备注")
    severity: NoteSeverity = Field(NoteSeverity.INFO, description="备注级别")


ContentElement = Annotated[
    Union[
        ActionElement,
        DialogueElement,
        ParentheticalElement,
        TransitionElement,
        NoteElement,
    ],
    Field(discriminator="type"),
]


# ---------------------------------------------------------------------------
# Character
# ---------------------------------------------------------------------------

class Relationship(BaseModel):
    character_id: str = Field(..., description="关联角色的 ID")
    relation: str = Field(..., description="关系类型")
    description: Optional[str] = Field(None, description="关系详情")


class Character(BaseModel):
    id: str = Field(..., pattern=r"^char_\d{3}$", description="唯一标识，格式 char_001")
    name: str = Field(..., min_length=1, description="角色主要名称")
    aliases: list[str] = Field(default_factory=list, description="别名/昵称/化名")
    role: CharacterRole = Field(..., description="角色类型")
    gender: Gender = Field(Gender.UNKNOWN, description="性别")
    age_range: Optional[str] = Field(None, description="年龄段")
    traits: list[str] = Field(default_factory=list, description="性格特征")
    description: Optional[str] = Field(None, description="外貌与背景描述")
    relationships: list[Relationship] = Field(default_factory=list, description="角色关系")
    first_appearance_scene: Optional[int] = Field(None, ge=1, description="首次出场场次")

    @field_validator("aliases")
    @classmethod
    def aliases_must_be_unique(cls, v: list[str]) -> list[str]:
        if len(v) != len(set(v)):
            raise ValueError("aliases must be unique")
        return v


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------

class Scene(BaseModel):
    scene_number: int = Field(..., ge=1, description="全局唯一场次编号")
    scene_heading: str = Field(..., min_length=1, description="场标 (slugline)")
    location: str = Field(..., min_length=1, description="地点描述")
    time_of_day: str = Field(..., min_length=1, description="时间")
    characters_present: list[str] = Field(default_factory=list, description="本场出现的角色 ID 列表")
    summary: Optional[str] = Field(None, description="本场内容概要")
    content: list[ContentElement] = Field(..., min_length=1, description="内容元素列表")


# ---------------------------------------------------------------------------
# Act
# ---------------------------------------------------------------------------

class Act(BaseModel):
    act_number: int = Field(..., ge=1, description="幕序号")
    title: Optional[str] = Field(None, description="幕标题")
    scenes: list[Scene] = Field(..., min_length=1, description="场景列表")


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

class Meta(BaseModel):
    title: str = Field(..., min_length=1, description="剧本标题")
    original_work: Optional[str] = Field(None, description="原著名称")
    original_author: Optional[str] = Field(None, description="原著作者")
    adapted_by: str = Field(default="AI Novel-to-Script v0.1.0", description="改编者标识")
    version: str = Field(default="0.1.0", description="剧本版本号")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="创建时间")
    language: str = Field(default="zh-CN", description="语言标签")
    total_acts: int = Field(..., ge=1, description="总幕数")
    total_scenes: int = Field(..., ge=1, description="总场数")
    source_file: Optional[str] = Field(None, description="源文件名")
    notes: list[str] = Field(default_factory=list, description="全局备注")


# ---------------------------------------------------------------------------
# Top-level Screenplay
# ---------------------------------------------------------------------------

class Screenplay(BaseModel):
    """顶层剧本模型。"""

    meta: Meta = Field(..., description="元数据")
    characters: list[Character] = Field(..., min_length=1, description="角色表")
    acts: list[Act] = Field(..., min_length=1, description="幕列表")

    @model_validator(mode="after")
    def validate_totals(self) -> "Screenplay":
        """Ensure meta totals match actual structure."""
        if self.meta.total_acts != len(self.acts):
            raise ValueError(
                f"meta.total_acts ({self.meta.total_acts}) != actual acts ({len(self.acts)})"
            )
        total_scenes = sum(len(act.scenes) for act in self.acts)
        if self.meta.total_scenes != total_scenes:
            raise ValueError(
                f"meta.total_scenes ({self.meta.total_scenes}) != actual scenes ({total_scenes})"
            )
        return self

    @model_validator(mode="after")
    def validate_character_refs(self) -> "Screenplay":
        """Ensure all character_id references exist in characters list."""
        valid_ids = {c.id for c in self.characters}
        valid_names = set()
        for c in self.characters:
            valid_names.add(c.name)
            valid_names.update(c.aliases)

        # Check characters_present in scenes
        for act in self.acts:
            for scene in act.scenes:
                for char_id in scene.characters_present:
                    if char_id not in valid_ids:
                        raise ValueError(
                            f"Scene {scene.scene_number}: character '{char_id}' not found in characters list"
                        )

        # Check dialogue character_id and character_name
        for act in self.acts:
            for scene in act.scenes:
                for elem in scene.content:
                    if isinstance(elem, DialogueElement):
                        if elem.character_id not in valid_ids:
                            raise ValueError(
                                f"Scene {scene.scene_number}: dialogue references unknown character_id '{elem.character_id}'"
                            )
                        target_char = next(c for c in self.characters if c.id == elem.character_id)
                        allowed = {target_char.name} | set(target_char.aliases)
                        if elem.character_name not in allowed:
                            raise ValueError(
                                f"Scene {scene.scene_number}: dialogue character_name '{elem.character_name}' "
                                f"does not match character '{elem.character_id}' name/aliases: {allowed}"
                            )

        # Check relationships
        for char in self.characters:
            for rel in char.relationships:
                if rel.character_id not in valid_ids:
                    raise ValueError(
                        f"Character '{char.id}': relationship references unknown character '{rel.character_id}'"
                    )

        return self

    @model_validator(mode="after")
    def validate_scene_numbering(self) -> "Screenplay":
        """Ensure scene numbers are globally unique and sequential."""
        scene_numbers = []
        for act in self.acts:
            for scene in act.scenes:
                scene_numbers.append(scene.scene_number)
        expected = list(range(1, len(scene_numbers) + 1))
        if scene_numbers != expected:
            raise ValueError(
                f"Scene numbers must be sequential 1..{len(scene_numbers)}, got {scene_numbers}"
            )
        return self


# ---------------------------------------------------------------------------
# YAML helpers
# ---------------------------------------------------------------------------

class ScreenplayYAML:
    """Serializer / deserializer for Screenplay to/from YAML."""

    @staticmethod
    def export_yaml(screenplay: Screenplay, **yaml_kwargs) -> str:
        """Export a Screenplay model to a YAML string.

        The top-level key is 'screenplay'.
        """
        data = {"screenplay": screenplay.model_dump(mode="json")}
        defaults = {"allow_unicode": True, "sort_keys": False, "default_flow_style": False}
        defaults.update(yaml_kwargs)
        return yaml.dump(data, **defaults)

    @staticmethod
    def parse_yaml(yaml_str: str) -> Screenplay:
        """Parse a YAML string into a Screenplay model with validation."""
        data = yaml.safe_load(yaml_str)
        if not isinstance(data, dict) or "screenplay" not in data:
            raise ValueError("YAML must contain a top-level 'screenplay' key")
        return Screenplay.model_validate(data["screenplay"])
