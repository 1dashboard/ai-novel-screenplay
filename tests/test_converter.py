"""Tests for the converter pipeline, parsers, and schema."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from src.parsers.txt_parser import TxtParser
from src.parsers.md_parser import MarkdownParser
from src.schema import (
    Screenplay,
    Meta,
    Character,
    Act,
    Scene,
    ActionElement,
    DialogueElement,
    NoteElement,
    NoteSeverity,
    CharacterRole,
    Gender,
    ScreenplayYAML,
)
from src.utils import match_character_name, normalize_name, text_similarity, truncate_text, count_chinese_chars


# ---------------------------------------------------------------------------
# Test data
# ---------------------------------------------------------------------------

SAMPLE_NOVEL = """第一章：测试章节

这是一段叙述文字。窗外下着雨。

"你好。"张三说。

"你好。"李四回答。

第二章：另一个测试

场景切换到了另一个地点。阳光明媚。

"天气不错。"张三笑了笑。

"是啊。"李四点头。

第三章：结局

故事在这里结束。

"再见。"张三说。

"再见。"李四说。"""


EXPECTED_CHAPTER_COUNT = 3


# ---------------------------------------------------------------------------
# Parser tests
# ---------------------------------------------------------------------------

class TestTxtParser:
    def test_parse_chapters(self):
        parser = TxtParser()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", encoding="utf-8", delete=False) as f:
            f.write(SAMPLE_NOVEL)
            f.flush()
            result = parser.parse(f.name)
        Path(f.name).unlink()

        assert len(result.chapters) == EXPECTED_CHAPTER_COUNT
        assert result.chapters[0].title == "测试章节"
        assert "窗外下着雨" in result.chapters[0].content

    def test_parse_empty_file(self):
        parser = TxtParser()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", encoding="utf-8", delete=False) as f:
            f.write("")
            f.flush()
            result = parser.parse(f.name)
        Path(f.name).unlink()

        # Empty file: fallback split returns empty list
        assert len(result.chapters) == 0


class TestMarkdownParser:
    def test_parse_chapters(self):
        md_content = """# 我的小说

## 第一章：开始

这是一段文字。

## 第二章：发展

另一段文字。

## 第三章：结局

最后一段。"""

        parser = MarkdownParser()
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", encoding="utf-8", delete=False) as f:
            f.write(md_content)
            f.flush()
            result = parser.parse(f.name)
        Path(f.name).unlink()

        # The first H1 ("# 我的小说") is treated as book title, not a chapter
        assert len(result.chapters) == 3


# ---------------------------------------------------------------------------
# Schema tests
# ---------------------------------------------------------------------------

class TestSchema:
    def test_minimal_screenplay(self):
        """A minimal valid screenplay should pass validation."""
        screenplay = Screenplay(
            meta=Meta(
                title="测试剧本",
                total_acts=1,
                total_scenes=1,
            ),
            characters=[
                Character(
                    id="char_001",
                    name="张三",
                    role=CharacterRole.PROTAGONIST,
                )
            ],
            acts=[
                Act(
                    act_number=1,
                    scenes=[
                        Scene(
                            scene_number=1,
                            scene_heading="INT. 房间 - 日",
                            location="房间",
                            time_of_day="日",
                            characters_present=["char_001"],
                            content=[
                                ActionElement(text="张三走进房间。"),
                            ],
                        )
                    ],
                )
            ],
        )
        validated = Screenplay.model_validate(screenplay.model_dump())
        assert validated.meta.title == "测试剧本"

    def test_missing_character_ref(self):
        """A scene referencing an undefined character should fail."""
        with pytest.raises(Exception):
            Screenplay(
                meta=Meta(title="测试", total_acts=1, total_scenes=1),
                characters=[
                    Character(id="char_001", name="张三", role=CharacterRole.PROTAGONIST),
                ],
                acts=[
                    Act(
                        act_number=1,
                        scenes=[
                            Scene(
                                scene_number=1,
                                scene_heading="INT. 房间 - 日",
                                location="房间",
                                time_of_day="日",
                                characters_present=["char_999"],  # undefined
                                content=[ActionElement(text="test")],
                            ),
                        ],
                    )
                ],
            )

    def test_scene_numbers_must_be_sequential(self):
        """Scene numbers must be 1, 2, 3..."""
        with pytest.raises(Exception):
            Screenplay(
                meta=Meta(title="测试", total_acts=1, total_scenes=2),
                characters=[
                    Character(id="char_001", name="张三", role=CharacterRole.PROTAGONIST),
                ],
                acts=[
                    Act(
                        act_number=1,
                        scenes=[
                            Scene(
                                scene_number=5,  # should start at 1
                                scene_heading="INT. X - 日",
                                location="X",
                                time_of_day="日",
                                content=[ActionElement(text="test")],
                            ),
                        ],
                    )
                ],
            )

    def test_yaml_roundtrip(self):
        """Export to YAML and parse back should preserve data."""
        screenplay = Screenplay(
            meta=Meta(title="Test", total_acts=1, total_scenes=1),
            characters=[
                Character(id="char_001", name="Alice", role=CharacterRole.PROTAGONIST),
            ],
            acts=[
                Act(
                    act_number=1,
                    scenes=[
                        Scene(
                            scene_number=1,
                            scene_heading="INT. Room - DAY",
                            location="Room",
                            time_of_day="日",
                            content=[ActionElement(text="Alice enters.")],
                        ),
                    ],
                )
            ],
        )
        yaml_str = ScreenplayYAML.export_yaml(screenplay)
        parsed = ScreenplayYAML.parse_yaml(yaml_str)
        assert parsed.meta.title == "Test"
        assert len(parsed.characters) == 1
        assert parsed.characters[0].name == "Alice"

    def test_dialogue_character_name_validation(self):
        """dialogue.character_name must match the referenced character's name or aliases."""
        with pytest.raises(Exception):
            Screenplay(
                meta=Meta(title="Test", total_acts=1, total_scenes=1),
                characters=[
                    Character(id="char_001", name="Alice", aliases=["Ali"], role=CharacterRole.PROTAGONIST),
                ],
                acts=[
                    Act(
                        act_number=1,
                        scenes=[
                            Scene(
                                scene_number=1,
                                scene_heading="INT. Room - DAY",
                                location="Room",
                                time_of_day="日",
                                content=[
                                    DialogueElement(
                                        character_id="char_001",
                                        character_name="WrongName",  # doesn't match Alice or Ali
                                        text="Hello",
                                    ),
                                ],
                            ),
                        ],
                    )
                ],
            )


# ---------------------------------------------------------------------------
# Utility tests
# ---------------------------------------------------------------------------

class TestUtils:
    def test_normalize_name(self):
        assert normalize_name("张三") == "张三"
        assert normalize_name(" 张 三 ") == "张三"
        assert normalize_name("Zhang San") == "zhangsan"

    def test_match_character_name_exact(self):
        known = [
            {"name": "林晓", "aliases": ["晓晓"]},
            {"name": "陈序", "aliases": []},
        ]
        assert match_character_name("林晓", known) == known[0]
        assert match_character_name("晓晓", known) == known[0]
        assert match_character_name("陈序", known) == known[1]
        assert match_character_name("王五", known) is None

    def test_match_character_name_fuzzy(self):
        known = [{"name": "林晓", "aliases": []}]
        # "林晓晓" contains "林晓" and is similar
        result = match_character_name("林晓晓", known)
        assert result is not None

    def test_count_chinese_chars(self):
        assert count_chinese_chars("Hello世界") == 2
        # "纯英文" means "pure English" in Chinese, so it IS Chinese
        assert count_chinese_chars("纯英文") == 3
        assert count_chinese_chars("English only") == 0
        assert count_chinese_chars("你好世界") == 4

    def test_truncate_text_short(self):
        text = "短文本"
        result = truncate_text(text, max_chars=1000)
        assert len(result) == 1
        assert result[0] == text

    def test_text_similarity(self):
        assert text_similarity("hello", "hello") == 1.0
        assert text_similarity("hello", "hallo") > 0.7
        assert text_similarity("abc", "xyz") < 0.5
