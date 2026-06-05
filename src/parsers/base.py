"""Base parser interface and shared data classes."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Chapter:
    """A single chapter extracted from a novel file."""
    number: int
    title: str
    content: str


@dataclass
class NovelText:
    """The result of parsing a novel input file."""
    title: str
    chapters: list[Chapter] = field(default_factory=list)
    source_path: str = ""


class BaseParser(ABC):
    """Abstract base for all input format parsers."""

    @abstractmethod
    def parse(self, file_path: str) -> NovelText:
        """Parse a file and return structured novel text."""
        ...

    @staticmethod
    def _detect_title(text: str) -> str:
        """Attempt to extract a title from the first few lines."""
        lines = text.strip().split("\n")
        for line in lines[:5]:
            line = line.strip()
            if line and len(line) <= 50 and not line.startswith("第"):
                return line
        return "未命名作品"

    @staticmethod
    def get_parser_for(file_path: str) -> BaseParser:
        """Factory: return the right parser for the given file extension."""
        from .txt_parser import TxtParser
        from .md_parser import MarkdownParser
        from .docx_parser import DocxParser
        from .doc_parser import DocParser
        from .pdf_parser import PdfParser

        ext = Path(file_path).suffix.lower()
        parsers = {
            ".txt": TxtParser,
            ".md": MarkdownParser,
            ".markdown": MarkdownParser,
            ".docx": DocxParser,
            ".doc": DocParser,
            ".pdf": PdfParser,
        }
        parser_cls = parsers.get(ext)
        if parser_cls is None:
            raise ValueError(f"Unsupported file format: {ext}. Supported: {list(parsers.keys())}")
        return parser_cls()
