"""Read EPUB e-books chapter by chapter using only the standard library.

Chapters follow the book's reading order (the OPF spine). Footnote markers,
footnote bodies, scripts and styles are dropped; each block element becomes
its own paragraph so the reader pauses in the right places.
"""

from __future__ import annotations

import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

BLOCK_TAGS = {
    "p", "div", "section", "article", "blockquote", "li", "tr", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6", "pre", "figcaption", "dd", "dt",
}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
SKIP_TAGS = {"script", "style", "head", "svg", "math", "nav", "table"}
NOTE_TYPES = {"footnote", "endnote", "rearnote", "note", "noteref", "pagebreak"}

# Chapters that are pointless to listen to.
SKIP_CHAPTER_RE = re.compile(
    r"^\s*(table of contents|contents|copyright|index|list of (figures|tables|illustrations))\s*$",
    re.IGNORECASE,
)

class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.buf: list[str] = []
        self.heading: str | None = None
        self._in_heading = False
        self._heading_buf: list[str] = []
        self._skip: list[str] = []  # stack of tags whose content is ignored

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        self.buf = []
        if text:
            self.lines.extend([text, ""])

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._skip:
            if tag not in {"br", "hr", "img", "meta", "link"}:
                self._skip.append(tag)
            return
        a = dict(attrs)
        etype = set((a.get("epub:type") or a.get("role") or "").replace("doc-", "").split())
        # <sup> is almost always a footnote number in e-books.
        if tag in SKIP_TAGS or tag == "sup" or etype & NOTE_TYPES:
            if tag not in {"br", "hr", "img"}:
                self._skip.append(tag)
            return
        if tag in BLOCK_TAGS:
            self._flush()
        if tag in HEADING_TAGS and self.heading is None:
            self._in_heading = True

    def handle_endtag(self, tag: str) -> None:
        if self._skip:
            if tag == self._skip[-1]:
                self._skip.pop()
            return
        if tag in HEADING_TAGS and self._in_heading:
            self._in_heading = False
            self.heading = re.sub(r"\s+", " ", "".join(self._heading_buf)).strip() or None
        if tag in BLOCK_TAGS:
            self._flush()

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        self.buf.append(data)
        if self._in_heading:
            self._heading_buf.append(data)

    def close(self) -> None:
        super().close()
        self._flush()


def read_epub(path: Path) -> tuple[str, list[tuple[str, list[str]]]]:
    """Return (book title, [(chapter title, lines), ...]) in reading order."""
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        opf_path = next(e.get("full-path") for e in container.iter() if e.tag.endswith("rootfile"))
        opf = ET.fromstring(z.read(opf_path))
        base = posixpath.dirname(opf_path)

        title = next((e.text for e in opf.iter() if e.tag.endswith("}title") and e.text), path.stem)
        manifest = {
            e.get("id"): e for e in opf.iter() if e.tag.endswith("}item") and e.get("id")
        }
        chapters: list[tuple[str, list[str]]] = []
        for ref in (e for e in opf.iter() if e.tag.endswith("}itemref")):
            item = manifest.get(ref.get("idref"))
            if item is None or ref.get("linear") == "no":
                continue
            if "nav" in (item.get("properties") or "").split():
                continue
            if "html" not in (item.get("media-type") or ""):
                continue
            href = posixpath.normpath(posixpath.join(base, unquote(item.get("href", ""))))
            try:
                raw = z.read(href).decode("utf-8", errors="ignore")
            except KeyError:
                continue
            parser = _TextExtractor()
            parser.feed(raw)
            parser.close()
            name = parser.heading or f"Part {len(chapters) + 1}"
            if SKIP_CHAPTER_RE.match(name) or not any(parser.lines):
                continue
            chapters.append((name, parser.lines))
    return title.strip(), chapters
