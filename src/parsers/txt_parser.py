"""Plain-text novel parser with chapter detection."""

from __future__ import annotations

import re
from pathlib import Path

from .base import BaseParser, NovelText, Chapter


# Patterns that match chapter headings in Chinese and English novels
CHAPTER_PATTERNS = [
    # 第X章 / 第X章：标题 / 第X章 标题
    r"^第[零一二三四五六七八九十百千\d]+章[：:\s]*(.*)",
    # Chapter X / Chapter X: Title
    r"^Chapter\s+\d+[：:\s]*(.*)",
    # 第一章 第一节 style
    r"^第[零一二三四五六七八九十百千\d]+[节回部卷][：:\s]*(.*)",
    # Numbered chapters: 1. / 1、/ 1：
    r"^(\d{1,4})[\.、：:]\s*(.*?)$",
]


class TxtParser(BaseParser):
    """Parser for plain-text (.txt) novel files."""

    def parse(self, file_path: str) -> NovelText:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        raw = path.read_text(encoding="utf-8")
        lines = raw.split("\n")

        title = self._detect_title(raw)
        chapters = self._split_chapters(lines)

        # Auto-number if no chapters detected
        if not chapters:
            chapters = self._fallback_split(raw)

        return NovelText(
            title=title,
            chapters=chapters,
            source_path=str(path.resolve()),
        )

    def _split_chapters(self, lines: list[str]) -> list[Chapter]:
        """Split lines into chapters based on regex patterns.

        Lines before the first chapter heading are discarded (title, preamble, etc.).
        """
        compiled = [re.compile(p, re.IGNORECASE) for p in CHAPTER_PATTERNS]
        chapters: list[Chapter] = []
        current_lines: list[str] = []
        current_title = ""
        seen_first_heading = False

        for line in lines:
            line_stripped = line.strip()
            matched = False
            for pat in compiled:
                m = pat.match(line_stripped)
                if m:
                    if seen_first_heading and current_lines:
                        content = "\n".join(current_lines).strip()
                        if content:
                            chapters.append(Chapter(
                                number=len(chapters) + 1,
                                title=current_title or f"第{len(chapters) + 1}章",
                                content=content,
                            ))
                    seen_first_heading = True
                    current_title = m.group(1).strip() if m.lastindex else line_stripped
                    current_lines = []
                    matched = True
                    break
            if not matched:
                current_lines.append(line)

        # Last chapter
        if seen_first_heading and current_lines:
            content = "\n".join(current_lines).strip()
            if content:
                chapters.append(Chapter(
                    number=len(chapters) + 1,
                    title=current_title or f"第{len(chapters) + 1}章",
                    content=content,
                ))

        return chapters

    def _fallback_split(self, text: str) -> list[Chapter]:
        """If no chapter headings detected, split by blank-line groups roughly."""
        text = text.strip()
        if not text:
            return []
        paragraphs = text.split("\n\n")
        if len(paragraphs) < 3:
            return [Chapter(number=1, title="全文", content=text.strip())]

        # Try to split into roughly equal parts
        n = max(3, len(paragraphs) // 15)  # roughly 15 paragraphs per chapter
        chunk_size = max(1, len(paragraphs) // n)
        chapters = []
        for i in range(n):
            start = i * chunk_size
            end = start + chunk_size if i < n - 1 else len(paragraphs)
            chunk = "\n\n".join(paragraphs[start:end]).strip()
            if chunk:
                chapters.append(Chapter(
                    number=i + 1,
                    title=f"第{i + 1}章",
                    content=chunk,
                ))
        return chapters
