"""Utility functions for text processing and character matching."""

from __future__ import annotations

import re
from difflib import SequenceMatcher


def count_chinese_chars(text: str) -> int:
    """Count the number of Chinese characters in text (for estimating chapter length)."""
    return len(re.findall(r"[一-鿿]", text))


def text_similarity(a: str, b: str) -> float:
    """Return a 0-1 similarity ratio between two strings."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def normalize_name(name: str) -> str:
    """Normalize a character name for matching: strip whitespace and punctuation."""
    return re.sub(r"[^\w一-鿿]", "", name).strip().lower()


def match_character_name(
    name: str,
    known_characters: list[dict],
    threshold: float = 0.75,
) -> dict | None:
    """Try to match a character name against the list of known characters.

    Matches by exact name, alias, or fuzzy similarity.

    Args:
        name: The name to look up.
        known_characters: List of known character dicts with 'name' and 'aliases'.
        threshold: Fuzzy match threshold (0-1).

    Returns:
        The matching character dict, or None if no match found.
    """
    norm = normalize_name(name)
    if not norm:
        return None

    best_score = 0.0
    best_match = None

    for c in known_characters:
        # Exact match on name
        if normalize_name(c["name"]) == norm:
            return c

        # Exact match on alias
        for alias in c.get("aliases", []):
            if normalize_name(alias) == norm:
                return c

        # Fuzzy match
        score = text_similarity(norm, normalize_name(c["name"]))
        if score > best_score:
            best_score = score
            best_match = c
        for alias in c.get("aliases", []):
            score = text_similarity(norm, normalize_name(alias))
            if score > best_score:
                best_score = score
                best_match = c

    if best_score >= threshold and best_match is not None:
        return best_match
    return None


def truncate_text(text: str, max_chars: int = 8000) -> list[str]:
    """Split long text into chunks that each fit within the character limit.

    Tries to split at natural boundaries (paragraphs, then sentences, then characters).
    """
    if count_chinese_chars(text) + len(text) <= max_chars:
        return [text]

    chunks = []
    paragraphs = text.split("\n\n")
    current = []

    for para in paragraphs:
        test = "\n\n".join(current + [para])
        if count_chinese_chars(test) + len(test) <= max_chars:
            current.append(para)
        else:
            if current:
                chunks.append("\n\n".join(current))
            # If a single paragraph exceeds the limit, split it by sentences
            if count_chinese_chars(para) + len(para) > max_chars:
                sub_chunks = _split_by_sentences(para, max_chars)
                chunks.extend(sub_chunks)
                current = []
            else:
                current = [para]

    if current:
        chunks.append("\n\n".join(current))

    return chunks or [text]


def _split_by_sentences(text: str, max_chars: int) -> list[str]:
    """Split a long text block into sentence-level chunks."""
    sentences = re.split(r"(?<=[。！？.!?])\s*", text)
    chunks = []
    current = []
    for s in sentences:
        test = "".join(current) + s
        if count_chinese_chars(test) + len(test) <= max_chars:
            current.append(s)
        else:
            if current:
                chunks.append("".join(current))
            current = [s]
    if current:
        chunks.append("".join(current))
    return chunks or [text]
