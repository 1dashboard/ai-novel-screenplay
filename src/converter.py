"""Core conversion pipeline: novel text → structured screenplay."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from .parsers.base import BaseParser, NovelText, Chapter
from .llm_client import LLMClient, ChapterAnalysis, ExtractedCharacter, ExtractedScene, SceneContent
from .schema import (
    Screenplay,
    Meta,
    Character,
    Relationship,
    Act,
    Scene,
    ActionElement,
    DialogueElement,
    ParentheticalElement,
    TransitionElement,
    NoteElement,
    CharacterRole,
    Gender,
    NoteSeverity,
    ScreenplayYAML,
)
from .evaluator import ScreenplayEvaluator
from .utils import match_character_name, truncate_text

logger = logging.getLogger(__name__)


class NovelToScriptConverter:
    """Main converter: orchestrates parsing → LLM analysis → structured output."""

    def __init__(self, config_path: str = "config.yaml"):
        self.config_path = config_path
        self.llm: LLMClient | None = None
        self._init_llm()

    def _init_llm(self) -> None:
        """Try to initialise the LLM client; set to None if unavailable."""
        try:
            self.llm = LLMClient(self.config_path)
        except Exception as e:
            logger.warning("LLM client unavailable: %s. Will run in parse-only mode.", e)
            self.llm = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def convert(
        self,
        input_path: str,
        output_path: str,
        *,
        use_llm: bool = True,
        max_workers: int = 4,
    ) -> Screenplay:
        """Convert a novel file to a screenplay YAML.

        Args:
            input_path: Path to the novel file (txt/md/docx/pdf).
            output_path: Path to write the YAML output.
            use_llm: If True (default), use Claude to analyze chapters.
                     If False, produces a structural template only.
            max_workers: Max parallel LLM calls for chapter analysis (default 4).

        Returns:
            The validated Screenplay model.
        """
        # Phase 1: Parse
        logger.info("Parsing input: %s", input_path)
        parser = BaseParser.get_parser_for(input_path)
        novel = parser.parse(input_path)
        logger.info("Found %d chapters in '%s'", len(novel.chapters), novel.title)

        if len(novel.chapters) < 3:
            logger.warning(
                "Only %d chapter(s) detected. The tool works best with 3+ chapters.",
                len(novel.chapters),
            )

        # Phase 2: Analyze (LLM or template)
        known_characters: list[dict] = []
        all_analyses: list[ChapterAnalysis] = []

        if use_llm and self.llm is not None:
            workers = min(max_workers, len(novel.chapters))
            if workers <= 1:
                all_analyses = self._analyze_sequential(novel.chapters, known_characters)
            else:
                logger.info("Using %d parallel workers for %d chapters", workers, len(novel.chapters))
                all_analyses = self._analyze_parallel(novel.chapters, known_characters, workers)
        else:
            logger.info("LLM disabled; producing structural template.")
            all_analyses = self._template_analyses(novel)

        # Phase 3: Assemble
        screenplay = self._assemble(novel, all_analyses)

        # Phase 4: Validate & export
        Screenplay.model_validate(screenplay.model_dump())  # full validation
        yaml_str = ScreenplayYAML.export_yaml(screenplay)
        Path(output_path).write_text(yaml_str, encoding="utf-8")
        logger.info("Screenplay written to %s", output_path)

        # Phase 5: Evaluate
        evaluator = ScreenplayEvaluator()
        report = evaluator.evaluate_file(output_path)
        report_path = Path(output_path).with_suffix(".eval.txt")
        report_path.write_text(report.summary(), encoding="utf-8")
        logger.info("Evaluation report written to %s", report_path)

        return screenplay

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------

    def _analyze_sequential(
        self,
        chapters: list[Chapter],
        known_characters: list[dict],
    ) -> list[ChapterAnalysis]:
        """Analyze chapters one by one, updating known_characters incrementally."""
        results: list[ChapterAnalysis] = []
        for chapter in chapters:
            analysis = self._analyze_chapter(chapter, known_characters)
            results.append(analysis)
            for ec in analysis.characters:
                if not match_character_name(ec.name, known_characters):
                    known_characters.append({
                        "name": ec.name,
                        "aliases": ec.aliases,
                        "role": ec.role,
                        "description": ec.description,
                    })
        return results

    def _analyze_parallel(
        self,
        chapters: list[Chapter],
        known_characters: list[dict],
        max_workers: int,
    ) -> list[ChapterAnalysis]:
        """Analyze chapters in parallel batches, syncing character context between batches.

        Strategy: first chapter runs alone to seed known_characters, then remaining
        chapters run in parallel batches.  This balances speed with character
        consistency — the LLM reuses character names when it knows about them.
        """
        results: dict[int, ChapterAnalysis] = {}

        # -- Batch 1: first chapter alone (builds initial character context) --
        first = chapters[0]
        analysis = self._analyze_chapter(first, known_characters)
        results[0] = analysis
        self._update_known_characters(known_characters, analysis)

        if len(chapters) == 1:
            return [results[0]]

        # -- Batches 2+: remaining chapters in parallel groups --
        remaining = chapters[1:]
        batch_size = max_workers  # full parallelism after first chapter
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            batch_idx = batch_start + 1  # offset in original chapters

            with ThreadPoolExecutor(max_workers=len(batch)) as executor:
                futures = {}
                for i, chapter in enumerate(batch):
                    # Snapshot current known_characters for each thread
                    snapshot = list(known_characters)
                    future = executor.submit(self._analyze_chapter, chapter, snapshot)
                    futures[future] = batch_idx + i

                for future in as_completed(futures):
                    idx = futures[future]
                    try:
                        batch_analysis = future.result()
                        results[idx] = batch_analysis
                        self._update_known_characters(known_characters, batch_analysis)
                    except Exception as e:
                        logger.error("Chapter %d analysis failed: %s", idx + 1, e)
                        raise

        return [results[i] for i in range(len(chapters))]

    @staticmethod
    def _update_known_characters(known_characters: list[dict], analysis: ChapterAnalysis) -> None:
        """Merge newly discovered characters from one analysis into the known list."""
        for ec in analysis.characters:
            if not match_character_name(ec.name, known_characters):
                known_characters.append({
                    "name": ec.name,
                    "aliases": ec.aliases,
                    "role": ec.role,
                    "description": ec.description,
                })

    def _analyze_chapter(
        self,
        chapter: Chapter,
        known_characters: list[dict],
    ) -> ChapterAnalysis:
        """Analyze one chapter, handling chunking for long texts."""
        chunks = truncate_text(chapter.content)
        if len(chunks) == 1:
            return self.llm.analyze_chapter(
                chapter.number,
                chapter.title,
                chapter.content,
                known_characters,
            )

        # Multi-chunk chapter: analyze each chunk, merge results
        logger.info("Chapter %d split into %d chunks", chapter.number, len(chunks))
        merged = ChapterAnalysis(
            chapter_number=chapter.number,
            chapter_title=chapter.title,
        )
        for i, chunk in enumerate(chunks):
            chunk_analysis = self.llm.analyze_chapter(
                chapter.number,
                f"{chapter.title}（第{i + 1}部分）",
                chunk,
                known_characters,
            )
            merged.characters.extend(chunk_analysis.characters)
            merged.scenes.extend(chunk_analysis.scenes)
            merged.notes.extend(chunk_analysis.notes)
        return merged

    @staticmethod
    def _template_analyses(novel: NovelText) -> list[ChapterAnalysis]:
        """Produce stub analyses when LLM is unavailable."""
        analyses = []
        for chapter in novel.chapters:
            analyses.append(ChapterAnalysis(
                chapter_number=chapter.number,
                chapter_title=chapter.title,
                notes=["（LLM 未启用，此为结构模板，需人工填充内容）"],
            ))
        return analyses

    # ------------------------------------------------------------------
    # Assembly
    # ------------------------------------------------------------------

    def _assemble(
        self,
        novel: NovelText,
        analyses: list[ChapterAnalysis],
    ) -> Screenplay:
        """Merge all chapter analyses into a single Screenplay model."""
        # Merge and deduplicate characters
        characters = self._merge_characters(analyses)

        # Build character ID lookup: name → id
        name_to_id: dict[str, str] = {}
        for c in characters:
            name_to_id[c.name] = c.id
            for alias in c.aliases:
                name_to_id[alias] = c.id

        # Build scenes with global numbering
        all_scenes: list[Scene] = []
        scene_counter = 0

        for analysis in analyses:
            chapter_note = f"来源：第{analysis.chapter_number}章 {analysis.chapter_title}"
            for es in analysis.scenes:
                scene_counter += 1

                # Resolve characters_present: name → id
                char_ids = []
                for name in es.characters_present:
                    cid = name_to_id.get(name) or self._fuzzy_lookup_id(name, characters)
                    if cid:
                        char_ids.append(cid)

                # Set first_appearance_scene
                for cid in char_ids:
                    char = next((c for c in characters if c.id == cid), None)
                    if char and char.first_appearance_scene is None:
                        char.first_appearance_scene = scene_counter

                # Build content elements
                content = []
                for elem in es.content:
                    content.append(self._convert_element(elem, name_to_id, characters))

                if not content:
                    scene_counter -= 1
                    continue

                all_scenes.append(Scene(
                    scene_number=scene_counter,
                    scene_heading=es.scene_heading or f"未命名场景 - 第{analysis.chapter_number}章",
                    location=es.location or "未知地点",
                    time_of_day=es.time_of_day or "日",
                    characters_present=char_ids,
                    summary=es.summary or "",
                    content=content,
                ))

            # If chapter had no scenes but has notes, add a note-only scene
            if not analysis.scenes and analysis.notes:
                scene_counter += 1
                all_scenes.append(Scene(
                    scene_number=scene_counter,
                    scene_heading=f"第{analysis.chapter_number}章：{analysis.chapter_title}",
                    location="（待定）",
                    time_of_day="日",
                    characters_present=[],
                    summary=f"章节概要：{analysis.chapter_title}",
                    content=[
                        NoteElement(
                            type="note",
                            text=n,
                            severity=NoteSeverity.INFO,
                        ) for n in analysis.notes
                    ],
                ))

        # Ensure at least one placeholder scene when no scenes found
        if not all_scenes:
            all_scenes = [Scene(
                scene_number=1,
                scene_heading="（待填充）",
                location="（待定）",
                time_of_day="日",
                summary="LLM 未启用，场景待人工填充",
                content=[NoteElement(
                    type="note",
                    text="此模板由 --no-llm 模式生成。请启用 LLM 或手动填充场景内容。",
                    severity=NoteSeverity.INFO,
                )],
            )]
            scene_counter = 1

        # Group scenes into acts (roughly 3 acts)
        acts = self._group_into_acts(all_scenes)

        # Collect all notes
        all_notes: list[str] = []
        for analysis in analyses:
            all_notes.extend(analysis.notes)

        meta = Meta(
            title=novel.title,
            original_work=novel.title,
            source_file=novel.source_path,
            total_acts=len(acts),
            total_scenes=scene_counter,
            created_at=datetime.now(timezone.utc),
            notes=all_notes,
        )

        return Screenplay(meta=meta, characters=characters or self._placeholder_characters(), acts=acts)

    # ------------------------------------------------------------------
    # Character merging
    # ------------------------------------------------------------------

    def _merge_characters(self, analyses: list[ChapterAnalysis]) -> list[Character]:
        """Merge characters across chapters, deduplicating by name/alias match."""
        merged: list[dict] = []  # intermediate dicts before final Character objects

        for analysis in analyses:
            for ec in analysis.characters:
                match = match_character_name(ec.name, merged)
                if match:
                    # Merge new info into existing
                    if ec.name not in match["aliases"]:
                        match["aliases"].extend(
                            a for a in ec.aliases if a not in match["aliases"]
                        )
                    for trait in ec.traits:
                        if trait not in match["traits"]:
                            match["traits"].append(trait)
                    if ec.description and not match["description"]:
                        match["description"] = ec.description
                    if ec.gender != "unknown" and match["gender"] == "unknown":
                        match["gender"] = ec.gender
                    if ec.age_range and not match.get("age_range"):
                        match["age_range"] = ec.age_range
                    # Merge relationships
                    existing_rels = {(r.get("character_name"), r["relation"]) for r in match.get("relationships", [])}
                    for rel in ec.relationships:
                        key = (rel.get("character_name"), rel["relation"])
                        if key not in existing_rels:
                            match.setdefault("relationships", []).append(rel)
                            existing_rels.add(key)
                else:
                    merged.append({
                        "name": ec.name,
                        "role": ec.role,
                        "aliases": list(ec.aliases),
                        "gender": ec.gender,
                        "age_range": ec.age_range,
                        "traits": list(ec.traits),
                        "description": ec.description,
                        "relationships": list(ec.relationships),
                    })

        # Convert to Character models with IDs
        characters = []
        for i, m in enumerate(merged):
            char_id = f"char_{i + 1:03d}"
            characters.append(Character(
                id=char_id,
                name=m["name"],
                aliases=m.get("aliases", []),
                role=CharacterRole(m.get("role", "minor")),
                gender=Gender(m.get("gender", "unknown")),
                age_range=m.get("age_range", ""),
                traits=m.get("traits", []),
                description=m.get("description", ""),
                relationships=[
                    Relationship(
                        character_id="",  # resolved after all IDs assigned
                        relation=r.get("relation", ""),
                        description=r.get("description", ""),
                    )
                    for r in m.get("relationships", [])
                ],
            ))

        # Second pass: resolve relationship character_ids
        name_to_id = {c.name: c.id for c in characters}
        for c in characters:
            # Also map aliases
            for alias_info in merged:
                if alias_info["name"] == c.name:
                    for rel_dict, rel_obj in zip(alias_info.get("relationships", []), c.relationships):
                        target_name = rel_dict.get("character_name", "")
                        target_id = name_to_id.get(target_name) or self._fuzzy_lookup_id(target_name, characters)
                        if target_id:
                            rel_obj.character_id = target_id
                    # Remove relationships without resolved IDs
                    c.relationships = [r for r in c.relationships if r.character_id]

        return characters

    @staticmethod
    def _fuzzy_lookup_id(name: str, characters: list[Character]) -> str | None:
        """Try to find a character ID by fuzzy name matching."""
        from .utils import normalize_name, text_similarity
        norm = normalize_name(name)
        if not norm:
            return None
        best_score = 0.0
        best_id = None
        for c in characters:
            score = text_similarity(norm, normalize_name(c.name))
            if score > best_score:
                best_score = score
                best_id = c.id
            for alias in c.aliases:
                score = text_similarity(norm, normalize_name(alias))
                if score > best_score:
                    best_score = score
                    best_id = c.id
        return best_id if best_score >= 0.6 else None

    # ------------------------------------------------------------------
    # Content element conversion
    # ------------------------------------------------------------------

    def _convert_element(
        self,
        elem: SceneContent,
        name_to_id: dict[str, str],
        characters: list[Character],
    ):
        """Convert a SceneContent to the appropriate Pydantic element."""
        elem_type = elem.type.lower()

        if elem_type == "action":
            return ActionElement(text=elem.text)

        elif elem_type == "dialogue":
            char_id = name_to_id.get(elem.character_name) or self._fuzzy_lookup_id(elem.character_name, characters)
            if char_id:
                # If matched via fuzzy lookup, add this name variant as an alias
                char = next((c for c in characters if c.id == char_id), None)
                if char and elem.character_name != char.name and elem.character_name not in char.aliases:
                    char.aliases.append(elem.character_name)
                    name_to_id[elem.character_name] = char_id
            else:
                # Unmatched name: add as a placeholder character dynamically
                char_id = f"char_{len(characters) + 1:03d}"
                characters.append(Character(
                    id=char_id,
                    name=elem.character_name,
                    role=CharacterRole.MINOR,
                    description="AI 未能在角色表中匹配到此名称，自动添加。",
                ))
                name_to_id[elem.character_name] = char_id
            return DialogueElement(
                character_id=char_id,
                character_name=elem.character_name,
                text=elem.text,
                delivery=elem.delivery,
            )

        elif elem_type == "parenthetical":
            return ParentheticalElement(text=elem.text)

        elif elem_type == "transition":
            return TransitionElement(text=elem.text)

        elif elem_type == "note":
            severity = NoteSeverity.INFO
            try:
                severity = NoteSeverity(elem.severity)
            except ValueError:
                pass
            return NoteElement(text=elem.text, severity=severity)

        else:
            logger.warning("Unknown content element type '%s', treating as action", elem_type)
            return ActionElement(text=elem.text)

    @staticmethod
    def _placeholder_characters() -> list[Character]:
        """Return a minimal placeholder character when LLM is disabled."""
        return [
            Character(
                id="char_001",
                name="（待提取）",
                role=CharacterRole.MINOR,
                description="LLM 未启用，角色待人工标注",
            )
        ]

    # ------------------------------------------------------------------
    # Act grouping
    # ------------------------------------------------------------------

    @staticmethod
    def _group_into_acts(scenes: list[Scene]) -> list[Act]:
        """Group scenes into a standard 3-act structure.

        If there are very few scenes (< 6), everything goes in one act.
        Otherwise roughly: Act 1 = 25%, Act 2 = 50%, Act 3 = 25%.
        """
        n = len(scenes)
        if n == 0:
            return []

        if n < 6:
            return [Act(act_number=1, title="", scenes=scenes)]

        # 3-act split
        act1_end = max(1, n // 4)
        act2_end = max(act1_end + 1, n * 3 // 4)

        return [
            Act(act_number=1, title="第一幕：开端", scenes=scenes[:act1_end]),
            Act(act_number=2, title="第二幕：发展", scenes=scenes[act1_end:act2_end]),
            Act(act_number=3, title="第三幕：结局", scenes=scenes[act2_end:]),
        ]
