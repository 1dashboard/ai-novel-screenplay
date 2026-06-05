"""Screenplay quality evaluator — automated metrics for output assessment."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .schema import (
    Screenplay,
    ScreenplayYAML,
    ActionElement,
    DialogueElement,
    NoteElement,
    TransitionElement,
    ParentheticalElement,
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class EvalReport:
    """Structured evaluation report for a screenplay."""

    file_path: str = ""
    title: str = ""

    # --- L1: Structural ---------------------------------------------------
    schema_valid: bool = False
    parse_errors: list[str] = field(default_factory=list)

    # --- L2: Format -------------------------------------------------------
    total_scenes: int = 0
    scenes_with_valid_heading: int = 0
    scenes_missing_heading: list[int] = field(default_factory=list)
    scenes_empty: list[int] = field(default_factory=list)

    # --- L3: Content quality ----------------------------------------------
    total_characters: int = 0
    characters_unreferenced: list[str] = field(default_factory=list)
    characters_no_dialogue: list[str] = field(default_factory=list)
    total_dialogue_count: int = 0
    total_action_count: int = 0
    total_note_count: int = 0
    dialogue_to_action_ratio: float = 0.0
    avg_dialogue_len: float = 0.0
    avg_action_len: float = 0.0
    notes_by_severity: Counter = field(default_factory=Counter)

    # --- Warnings ---------------------------------------------------------
    warnings: list[str] = field(default_factory=list)
    score: int = 0  # 0–100

    def summary(self) -> str:
        """Human-readable summary."""
        lines = [
            f"{'='*60}",
            f"  评估报告：{self.title or '(无标题)'}",
            f"  文件：{self.file_path}",
            f"{'='*60}",
            f"",
            f"  [L1 结构校验] {'PASS' if self.schema_valid else 'FAIL'}",
            f"  [L2 格式规范] {self.scenes_with_valid_heading}/{self.total_scenes} 场景标题合法",
            f"  [L3 内容质量] 角色 {self.total_characters} | 对白 {self.total_dialogue_count} | 动作 {self.total_action_count}",
            f"                对白/动作比 {self.dialogue_to_action_ratio:.2f} | 备注 {self.total_note_count}",
            f"",
            f"  综合评分：{self.score}/100",
        ]
        if self.warnings:
            lines.append(f"\n  警告 ({len(self.warnings)} 条)：")
            for w in self.warnings:
                lines.append(f"    - {w}")
        if self.scenes_missing_heading:
            lines.append(f"\n  无标题场景：{self.scenes_missing_heading}")
        if self.characters_unreferenced:
            lines.append(f"\n  未被引用的角色：{self.characters_unreferenced}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Evaluator
# ---------------------------------------------------------------------------

class ScreenplayEvaluator:
    """Evaluate a screenplay YAML across multiple quality dimensions."""

    # Standard heading pattern: INT./EXT. + LOCATION + - + TIME
    HEADING_RE = re.compile(
        r"^(INT\.?|EXT\.?|INT\.?/EXT\.?|I/E)\s+.+\s+[-–—]\s*.+$",
        re.IGNORECASE,
    )

    def evaluate_file(self, yaml_path: str) -> EvalReport:
        """Load and evaluate a screenplay YAML file."""
        report = EvalReport(file_path=str(Path(yaml_path).resolve()))

        # --- L1: Schema validation ---
        try:
            yaml_str = Path(yaml_path).read_text(encoding="utf-8")
            screenplay = ScreenplayYAML.parse_yaml(yaml_str)
            report.schema_valid = True
            report.title = screenplay.meta.title
        except Exception as e:
            report.schema_valid = False
            report.parse_errors.append(str(e))
            report.warnings.append(f"Schema 校验失败：{e}")
            report.score = 0
            return report

        # --- L2: Format checks ---
        self._check_format(screenplay, report)

        # --- L3: Content checks ---
        self._check_content(screenplay, report)

        # --- Score ---
        report.score = self._compute_score(report)

        return report

    # ------------------------------------------------------------------
    # L2: Format
    # ------------------------------------------------------------------

    def _check_format(self, sp: Screenplay, report: EvalReport) -> None:
        """Validate scene headings and element structure."""
        for act in sp.acts:
            for scene in act.scenes:
                report.total_scenes += 1

                # Heading format
                heading = scene.scene_heading or ""
                if self.HEADING_RE.match(heading):
                    report.scenes_with_valid_heading += 1
                else:
                    report.scenes_missing_heading.append(scene.scene_number)
                    report.warnings.append(
                        f"场景 {scene.scene_number} 标题格式不标准：「{heading[:50]}」"
                    )

                # Empty scenes
                if not scene.content:
                    report.scenes_empty.append(scene.scene_number)
                    report.warnings.append(f"场景 {scene.scene_number} 无内容元素")

    # ------------------------------------------------------------------
    # L3: Content
    # ------------------------------------------------------------------

    def _check_content(self, sp: Screenplay, report: EvalReport) -> None:
        """Analyze content quality metrics."""
        report.total_characters = len(sp.characters)

        # Build character reference index
        all_char_ids = {c.id for c in sp.characters}
        char_id_to_name = {c.id: c.name for c in sp.characters}
        referenced_ids: set[str] = set()
        chars_with_dialogue: set[str] = set()

        dialogue_lengths: list[int] = []
        action_lengths: list[int] = []

        for act in sp.acts:
            for scene in act.scenes:
                for cid in (scene.characters_present or []):
                    referenced_ids.add(cid)

                for elem in scene.content:
                    if isinstance(elem, DialogueElement):
                        report.total_dialogue_count += 1
                        chars_with_dialogue.add(elem.character_id)
                        dialogue_lengths.append(len(elem.text))
                    elif isinstance(elem, ActionElement):
                        report.total_action_count += 1
                        action_lengths.append(len(elem.text))
                    elif isinstance(elem, TransitionElement):
                        report.total_action_count += 1  # transitions ≈ action
                    elif isinstance(elem, NoteElement):
                        report.total_note_count += 1
                        report.notes_by_severity[elem.severity.value] += 1
                    elif isinstance(elem, ParentheticalElement):
                        pass  # neutral

        # Ratio
        if report.total_action_count > 0:
            report.dialogue_to_action_ratio = round(
                report.total_dialogue_count / report.total_action_count, 2
            )

        # Averages
        report.avg_dialogue_len = (
            round(sum(dialogue_lengths) / len(dialogue_lengths), 1)
            if dialogue_lengths
            else 0.0
        )
        report.avg_action_len = (
            round(sum(action_lengths) / len(action_lengths), 1)
            if action_lengths
            else 0.0
        )

        # Unreferenced characters
        for c in sp.characters:
            if c.id not in referenced_ids:
                report.characters_unreferenced.append(c.name)
                report.warnings.append(f"角色「{c.name}」({c.id}) 未被任何场景引用")
            if c.id not in chars_with_dialogue:
                report.characters_no_dialogue.append(c.name)

        # Note severity distribution
        if report.total_note_count > 3:
            report.warnings.append(
                f"LLM 产生了 {report.total_note_count} 条备注，可能对部分内容不够确定"
            )

        # Imbalanced dialogue/action
        if report.total_dialogue_count == 0 and report.total_scenes > 0:
            report.warnings.append("剧本中无对白，可能 LLM 未能正确识别对话")
        if report.dialogue_to_action_ratio > 3.0:
            report.warnings.append(
                f"对白/动作比过高 ({report.dialogue_to_action_ratio})，可能缺少场景描写"
            )

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_score(report: EvalReport) -> int:
        """Compute a weighted composite score (0–100)."""
        if not report.schema_valid:
            return 0

        score = 100

        # Heading format: up to -15
        if report.total_scenes > 0:
            heading_rate = report.scenes_with_valid_heading / report.total_scenes
            score -= int((1 - heading_rate) * 15)

        # Empty scenes: up to -10
        if report.total_scenes > 0:
            score -= min(10, len(report.scenes_empty) * 5)

        # Unreferenced characters: up to -10
        if report.total_characters > 0:
            unreferenced_rate = len(report.characters_unreferenced) / report.total_characters
            score -= int(unreferenced_rate * 10)

        # No dialogue: -20
        if report.total_dialogue_count == 0 and report.total_scenes > 0:
            score -= 20

        # Too many notes: up to -10
        note_rate = report.total_note_count / max(report.total_scenes, 1)
        if note_rate > 1.0:
            score -= min(10, int(note_rate * 5))

        # Imbalanced ratio: up to -5
        if report.dialogue_to_action_ratio > 3.0 or (
            report.total_action_count > 0 and report.dialogue_to_action_ratio < 0.1
        ):
            score -= 5

        return max(0, score)


# ---------------------------------------------------------------------------
# CLI (standalone usage)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    evaluator = ScreenplayEvaluator()
    for path in sys.argv[1:]:
        report = evaluator.evaluate_file(path)
        print(report.summary())
