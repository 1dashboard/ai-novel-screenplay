""".doc (legacy Word) novel parser.

Extracts text from OLE2 binary .doc files.
Strategy order: LibreOffice CLI → olefile stream extraction → binary scan.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

from .base import BaseParser, NovelText, Chapter


class DocParser(BaseParser):
    """Parser for legacy Word (.doc) binary files."""

    CHAPTER_PATTERNS = [
        re.compile(r"^第[零一二三四五六七八九十百千\d]+章[：:\s]*(.*)", re.IGNORECASE),
        re.compile(r"^Chapter\s+\d+[：:\s]*(.*)", re.IGNORECASE),
        re.compile(r"^第[零一二三四五六七八九十百千\d]+[节回部卷][：:\s]*(.*)", re.IGNORECASE),
    ]

    def parse(self, file_path: str) -> NovelText:
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        raw_bytes = path.read_bytes()
        text = self._extract_text(raw_bytes)

        if len(text.strip()) < 100:
            raise ValueError(
                "Could not extract sufficient text from .doc file. "
                "Try converting it to .docx first with Word or LibreOffice."
            )

        title = self._detect_title(text)
        chapters = self._split_chapters(text.split("\n"))

        if len(chapters) < 3:
            from .txt_parser import TxtParser
            fallback = TxtParser()
            chapters = fallback._split_chapters(text.split("\n"))

        return NovelText(
            title=title,
            chapters=chapters,
            source_path=str(path.resolve()),
        )

    def _extract_text(self, data: bytes) -> str:
        """Extract readable text using multiple strategies."""
        # Strategy 1: LibreOffice CLI
        text = self._try_libreoffice(data)
        if text and len(text.strip()) > 200:
            return text

        # Strategy 2: antiword CLI
        text = self._try_antiword(data)
        if text and len(text.strip()) > 200:
            return text

        # Strategy 3: olefile WordDocument stream
        text = self._try_olefile(data)
        if text and len(text.strip()) > 200:
            return text

        # Strategy 4: binary scan (last resort)
        return self._binary_scan(data)

    # ------------------------------------------------------------------
    # Strategy implementations
    # ------------------------------------------------------------------

    @staticmethod
    def _try_libreoffice(data: bytes) -> str | None:
        """Convert .doc to text via LibreOffice headless mode."""
        try:
            with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as f:
                f.write(data)
                doc_path = f.name

            out_dir = tempfile.mkdtemp()
            result = subprocess.run(
                ["soffice", "--headless", "--convert-to", "txt:Text",
                 "--outdir", out_dir, doc_path],
                capture_output=True, text=True, timeout=60,
            )
            Path(doc_path).unlink(missing_ok=True)

            if result.returncode == 0:
                txt_files = list(Path(out_dir).glob("*.txt"))
                if txt_files:
                    text = txt_files[0].read_text(encoding="utf-8", errors="replace")
                    for f in Path(out_dir).iterdir():
                        f.unlink(missing_ok=True)
                    Path(out_dir).rmdir()
                    return text
            Path(out_dir).rmdir()
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass
        return None

    @staticmethod
    def _try_antiword(data: bytes) -> str | None:
        """Try using antiword CLI tool."""
        try:
            with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as f:
                f.write(data)
                f.flush()
                result = subprocess.run(
                    ["antiword", f.name],
                    capture_output=True, text=True, timeout=30,
                )
            Path(f.name).unlink(missing_ok=True)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass
        return None

    @staticmethod
    def _try_olefile(data: bytes) -> str | None:
        """Extract text from OLE2 WordDocument stream."""
        try:
            import olefile
            ole = olefile.OleFileIO(data)
            # Try to read the WordDocument stream
            if ole.exists("WordDocument"):
                stream = ole.openstream("WordDocument")
                raw = stream.read()
                ole.close()
                # The WordDocument stream starts with FIB header;
                # text begins after a variable-length header.
                # Extract readable character sequences.
                return DocParser._extract_text_from_word_stream(raw)
            ole.close()
        except Exception:
            pass
        return None

    @staticmethod
    def _extract_text_from_word_stream(raw: bytes) -> str:
        """Extract readable CJK/ASCII text from a raw WordDocument stream."""
        # The text in .doc files is stored with formatting bytes interspersed.
        # We scan for sequences of readable characters.
        result: list[str] = []
        buf: list[str] = []

        def flush_buf():
            nonlocal buf
            if len(buf) >= 5:  # minimum meaningful CJK phrase
                result.append("".join(buf))
            buf = []

        i = 0
        while i < len(raw):
            # Try UTF-16LE decoding (common in .doc)
            if i + 1 < len(raw):
                try:
                    cp = int.from_bytes(raw[i:i+2], "little")
                    char = chr(cp)
                    if DocParser._is_readable(cp):
                        buf.append(char)
                        i += 2
                        continue
                    else:
                        flush_buf()
                        if cp == 0x000D or cp == 0x000A:
                            result.append("\n")
                        i += 2
                        continue
                except (ValueError, UnicodeError):
                    pass

            # Try single byte ASCII
            byte = raw[i]
            if 0x20 <= byte <= 0x7E:
                buf.append(chr(byte))
            else:
                flush_buf()
                if byte == 0x0D or byte == 0x0A:
                    result.append("\n")
            i += 1

        flush_buf()
        return "".join(result)

    @staticmethod
    def _is_readable(cp: int) -> bool:
        return (0x4E00 <= cp <= 0x9FFF or   # CJK Unified
                0x3400 <= cp <= 0x4DBF or   # CJK Extension A
                0x3000 <= cp <= 0x303F or   # CJK punctuation
                0xFF00 <= cp <= 0xFFEF or   # Fullwidth forms
                0x20 <= cp <= 0x7E)         # ASCII printable

    @staticmethod
    def _binary_scan(data: bytes) -> str:
        """Last-resort: scan raw bytes for readable character sequences."""
        result: list[str] = []
        i = 0
        while i < len(data):
            decoded = ""
            for size in [3, 2, 1]:
                if i + size <= len(data):
                    try:
                        text = data[i:i + size].decode("utf-8")
                        if all(DocParser._is_readable(ord(ch)) for ch in text):
                            decoded = text
                            break
                    except UnicodeDecodeError:
                        continue
            if decoded:
                result.append(decoded)
                i += max(len(decoded.encode("utf-8")), 1)
            else:
                i += 1
        return "".join(result)

    # ------------------------------------------------------------------
    # Chapter splitting
    # ------------------------------------------------------------------

    def _split_chapters(self, lines: list[str]) -> list[Chapter]:
        chapters: list[Chapter] = []
        current_lines: list[str] = []
        current_title = ""
        seen_first_heading = False

        for line in lines:
            line_stripped = line.strip()
            if not line_stripped:
                continue

            matched = False
            for pat in self.CHAPTER_PATTERNS:
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
            if not matched and seen_first_heading:
                current_lines.append(line_stripped)

        if seen_first_heading and current_lines:
            content = "\n".join(current_lines).strip()
            if content:
                chapters.append(Chapter(
                    number=len(chapters) + 1,
                    title=current_title or f"第{len(chapters) + 1}章",
                    content=content,
                ))

        return chapters
