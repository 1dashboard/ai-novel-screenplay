"""Markdown novel parser with header-based chapter detection."""

from __future__ import annotations

import re
from pathlib import Path

from .base import BaseParser, NovelText, Chapter


class MarkdownParser(BaseParser):
    """Parser for Markdown (.md) novel files.

    Detects chapters via markdown headers (## Chapter X, # 第X章, etc.)
    """

    CHAPTER_HEADER = re.compile(
        r"^#{1,3}\s*(?:第[零一二三四五六七八九十百千\d]+章|Chapter\s+\d+|"
        r"第[零一二三四五六七八九十百千\d]+[节回部卷])",
        re.IGNORECASE,
    )

    def parse(self, file_path: str) -> NovelText:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        raw = path.read_text(encoding="utf-8")
        lines = raw.split("\n")

        # Extract title from first H1, remove it from lines
        title = "未命名作品"
        cleaned_lines = list(lines)
        for i, line in enumerate(lines[:10]):
            m = re.match(r"^#\s+(.+)", line.strip())
            if m:
                title = m.group(1).strip()
                cleaned_lines.pop(i)
                break
        if title == "未命名作品":
            title = self._detect_title(raw)

        chapters = self._split_by_headers(cleaned_lines)

        if len(chapters) < 3:
            from .txt_parser import TxtParser
            fallback = TxtParser()
            chapters = fallback._split_chapters(lines)

        return NovelText(
            title=title,
            chapters=chapters,
            source_path=str(path.resolve()),
        )

    def _split_by_headers(self, lines: list[str]) -> list[Chapter]:
        """Split markdown by chapter headers."""
        chapters: list[Chapter] = []
        current_lines: list[str] = []
        current_title = ""

        for line in lines:
            if self.CHAPTER_HEADER.match(line.strip()):
                if current_lines:
                    content = "\n".join(current_lines).strip()
                    if content:
                        chapters.append(Chapter(
                            number=len(chapters) + 1,
                            title=current_title or f"第{len(chapters) + 1}章",
                            content=content,
                        ))
                current_title = re.sub(r"^#+\s*", "", line.strip())
                current_lines = []
            else:
                current_lines.append(line)

        if current_lines:
            content = "\n".join(current_lines).strip()
            if content:
                chapters.append(Chapter(
                    number=len(chapters) + 1,
                    title=current_title or f"第{len(chapters) + 1}章",
                    content=content,
                ))

        return chapters
