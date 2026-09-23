"""Turn a research paper or book (PDF, EPUB, text, or arXiv link) into clean, listenable text.

The cleanup mirrors what makes paper-to-audio tools pleasant to listen to:
running headers/footers and page numbers are dropped, hyphenated line breaks
are joined, inline citations and URLs are removed, and the reference list
(plus anything after it, such as appendices, if requested) is skipped.
"""

from __future__ import annotations

import re
import urllib.request
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

from .epub import read_epub

ARXIV_RE = re.compile(
    r"^(?:https?://(?:www\.)?arxiv\.org/(?:abs|pdf)/)?(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?/?$"
)

END_SECTION_RE = re.compile(
    r"^\s*(?:\d+\.?\s*|[IVX]+\.\s*)?(references|bibliography|works cited|literature cited)\s*$",
    re.IGNORECASE,
)
APPENDIX_RE = re.compile(
    r"^\s*(?:[A-Z]\.?\s*)?(appendix|appendices|supplementary material)\b.*$",
    re.IGNORECASE,
)
NOTES_RE = re.compile(r"^\s*(notes|endnotes|footnotes)\s*$", re.IGNORECASE)
ACK_RE = re.compile(r"^\s*(?:\d+\.?\s*)?acknowledge?ments?\s*$", re.IGNORECASE)
CAPTION_RE = re.compile(r"^\s*(figure|fig\.|table|algorithm)\s*\d+[.:]", re.IGNORECASE)

# [1], [2, 5], [3-7], [Smith 2020]
BRACKET_CITE_RE = re.compile(r"\s?\[(?:[\w\s.,;&+\-–]*\d[\w\s.,;&+\-–]*)\]")
# (Smith et al., 2020), (Smith and Lee, 2019; Doe, 2021a)
PAREN_CITE_RE = re.compile(
    r"\s?\((?:see\s+|e\.g\.,?\s+|cf\.\s+)?"
    r"[A-Z][A-Za-z\-'’]+(?:\s+(?:et al\.|and|&)\s*[A-Z]?[A-Za-z\-'’]*)*,?\s+\d{4}[a-z]?"
    r"(?:\s*[;,]\s*[A-Z][A-Za-z\-'’]+(?:\s+(?:et al\.|and|&)\s*[A-Z]?[A-Za-z\-'’]*)*,?\s+\d{4}[a-z]?)*\)"
)
URL_RE = re.compile(r"https?://\S+|www\.\S+")
PAGE_NUM_RE = re.compile(r"^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?\s*$", re.IGNORECASE)


@dataclass
class Options:
    skip_references: bool = True
    skip_appendix: bool = False
    skip_acknowledgements: bool = True
    skip_captions: bool = True
    remove_citations: bool = True
    remove_urls: bool = True


@dataclass
class Document:
    title: str
    text: str
    pages: int = 0
    chapters: list[tuple[str, str]] = field(default_factory=list)


def fetch(source: str, dest_dir: Path) -> Path:
    """Resolve an arXiv ID / URL / local path into a local file."""
    m = ARXIV_RE.match(source.strip())
    if m:
        source = f"https://arxiv.org/pdf/{m.group(1)}"
    if source.startswith(("http://", "https://")):
        dest_dir.mkdir(parents=True, exist_ok=True)
        name = re.sub(r"[^\w.-]+", "_", source.rstrip("/").rsplit("/", 1)[-1]) or "download"
        if not name.lower().endswith((".pdf", ".txt", ".epub")):
            name += ".pdf"
        out = dest_dir / name
        req = urllib.request.Request(source, headers={"User-Agent": "paper2audio/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            out.write_bytes(resp.read())
        return out
    path = Path(source).expanduser()
    if not path.exists():
        raise FileNotFoundError(source)
    return path


def load(path: Path, opts: Options | None = None) -> Document:
    opts = opts or Options()
    if path.suffix.lower() in {".txt", ".md"}:
        raw = path.read_text(encoding="utf-8", errors="ignore")
        return Document(title=path.stem, text=clean_text(raw.splitlines(), opts))
    if path.suffix.lower() == ".epub":
        return _load_epub(path, opts)
    return _load_pdf(path, opts)


def _load_epub(path: Path, opts: Options) -> Document:
    title, raw_chapters = read_epub(path)
    chapters: list[tuple[str, str]] = []
    for name, lines in raw_chapters:
        if opts.skip_references and (END_SECTION_RE.match(name) or NOTES_RE.match(name)):
            continue
        if opts.skip_acknowledgements and ACK_RE.match(name):
            continue
        if opts.skip_appendix and APPENDIX_RE.match(name):
            continue
        text = clean_text(lines, opts)
        if text:
            chapters.append((name, text))
    text = "\n\n".join(t for _, t in chapters)
    return Document(title=title, text=text, pages=len(chapters), chapters=chapters)


def _load_pdf(path: Path, opts: Options) -> Document:
    doc = pymupdf.open(path)
    title = (doc.metadata or {}).get("title") or ""
    page_lines: list[list[str]] = []
    for page in doc:
        lines: list[str] = []
        # Blocks come back in reading order for most single/two-column layouts.
        for block in page.get_text("blocks", sort=False):
            if block[6] != 0:  # image block
                continue
            text = block[4].strip()
            if text:
                lines.extend(text.splitlines())
                lines.append("")  # paragraph break between blocks
        page_lines.append(lines)

    repeated = _repeated_lines(page_lines)
    flat: list[str] = []
    for lines in page_lines:
        for line in lines:
            key = _norm(line)
            if key and key in repeated:
                continue
            if PAGE_NUM_RE.match(line):
                continue
            flat.append(line)

    if not title:
        title = next((l.strip() for l in flat if len(l.strip()) > 8), path.stem)
    return Document(title=title.strip(), text=clean_text(flat, opts), pages=len(page_lines))


def _norm(line: str) -> str:
    return re.sub(r"\d+", "#", line.strip().lower())


def _repeated_lines(pages: list[list[str]]) -> set[str]:
    """Lines that recur at the top/bottom of many pages are running headers/footers."""
    if len(pages) < 3:
        return set()
    counts: Counter[str] = Counter()
    for lines in pages:
        edge = [l for l in lines if l.strip()]
        edge = edge[:2] + edge[-2:]
        counts.update({_norm(l) for l in edge if len(l.strip()) < 120})
    threshold = max(3, len(pages) // 2)
    return {k for k, c in counts.items() if c >= threshold}


def clean_text(lines: list[str], opts: Options) -> str:
    kept: list[str] = []
    skipping_caption = False
    in_ack = False
    for line in lines:
        stripped = line.strip()
        if opts.skip_references and END_SECTION_RE.match(stripped):
            break
        if opts.skip_appendix and APPENDIX_RE.match(stripped) and len(stripped) < 80:
            break
        if opts.skip_acknowledgements:
            if ACK_RE.match(stripped):
                in_ack = True
                continue
            if in_ack:
                # Acknowledgements end at the next short heading-like line.
                if stripped and len(stripped) < 60 and not stripped.endswith("."):
                    in_ack = False
                else:
                    continue
        if opts.skip_captions:
            if CAPTION_RE.match(stripped):
                skipping_caption = True
                continue
            if skipping_caption:
                if not stripped:
                    skipping_caption = False
                continue
        kept.append(line)

    paragraphs = _join_paragraphs(kept)
    out = []
    for para in paragraphs:
        if opts.remove_citations:
            para = BRACKET_CITE_RE.sub("", para)
            para = PAREN_CITE_RE.sub("", para)
        if opts.remove_urls:
            para = URL_RE.sub("", para)
        para = _speakable(para)
        if _is_noise(para):
            continue
        out.append(para)
    return "\n\n".join(out)


def _join_paragraphs(lines: list[str]) -> list[str]:
    paras: list[str] = []
    buf = ""
    for line in lines:
        s = line.strip()
        if not s:
            if buf:
                paras.append(buf)
                buf = ""
            continue
        if not buf:
            buf = s
        elif buf.endswith("-") and s[:1].islower():
            buf = buf[:-1] + s  # de-hyphenate "exam-\nple"
        else:
            buf += " " + s
    if buf:
        paras.append(buf)

    # Blocks often split mid-sentence across columns/pages; merge those back.
    merged: list[str] = []
    for p in paras:
        if merged and not re.search(r'[.!?:;"”)]$', merged[-1]) and p[:1].islower():
            merged[-1] += " " + p
        else:
            merged.append(p)
    return merged


def _speakable(text: str) -> str:
    replacements = {
        "e.g.": "for example",
        "i.e.": "that is",
        "et al.": "and colleagues",
        "w.r.t.": "with respect to",
        "vs.": "versus",
        "≈": " approximately ",
        "≤": " less than or equal to ",
        "≥": " greater than or equal to ",
        "±": " plus or minus ",
        "×": " times ",
        "→": " to ",
        "∼": " approximately ",
        "%": " percent",
        "ﬁ": "fi",
        "ﬂ": "fl",
        "ﬀ": "ff",
        "ﬃ": "ffi",
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    text = re.sub(r"[\u0000-\u0008\u000b-\u001f]", "", text)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def _is_noise(para: str) -> bool:
    if len(para) < 3:
        return True
    letters = sum(c.isalpha() for c in para)
    # Equations, tables of numbers and symbol soup read terribly aloud.
    return letters / max(len(para), 1) < 0.5
