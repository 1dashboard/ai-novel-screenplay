"""PDF novel parser using PyMuPDF."""

from __future__ import annotations

import re
from pathlib import Path

from .base import BaseParser, NovelText, Chapter

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None


class PdfParser(BaseParser):
    """Parser for PDF novel files using PyMuPDF."""

    CHAPTER_PATTERNS = [
        re.compile(r"^第[零一二三四五六七八九十百千\d]+章[：:\s]*(.*)", re.IGNORECASE),
        re.compile(r"^Chapter\s+\d+[：:\s]*(.*)", re.IGNORECASE),
        re.compile(r"^第[零一二三四五六七八九十百千\d]+[节回部卷][：:\s]*(.*)", re.IGNORECASE),
    ]

    def parse(self, file_path: str) -> NovelText:
        if fitz is None:
            raise ImportError("PyMuPDF is required to parse PDF files. Install it: pip install PyMuPDF")

        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        doc = fitz.open(str(path))

        # Extract text page by page
        pages_text: list[str] = []
        for page in doc:
            text = page.get_text("text")
            pages_text.append(text)
        doc.close()

        full_text = "\n".join(pages_text)
        lines = full_text.split("\n")

        title = self._detect_title(full_text)
        chapters = self._split_chapters(lines)

        if len(chapters) < 3:
            from .txt_parser import TxtParser
            fallback = TxtParser()
            chapters = fallback._split_chapters(lines)

        return NovelText(
            title=title,
            chapters=chapters,
            source_path=str(path.resolve()),
        )

    def _split_chapters(self, lines: list[str]) -> list[Chapter]:
        """Split PDF lines into chapters."""
        chapters: list[Chapter] = []
        current_lines: list[str] = []
        current_title = ""

        for line in lines:
            line = line.strip()
            if not line:
                current_lines.append("")
                continue

            matched = False
            for pat in self.CHAPTER_PATTERNS:
                m = pat.match(line)
                if m:
                    if current_lines:
                        content = "\n".join(current_lines).strip()
                        if content:
                            chapters.append(Chapter(
                                number=len(chapters) + 1,
                                title=current_title or f"第{len(chapters) + 1}章",
                                content=content,
                            ))
                    current_title = m.group(1).strip() if m.lastindex else line
                    current_lines = []
                    matched = True
                    break
            if not matched:
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
