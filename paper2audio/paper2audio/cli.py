"""Command line: python -m paper2audio.cli paper.pdf [-o out.mp3]"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import tempfile
from pathlib import Path

from . import extract, tts


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Convert papers/PDFs to audiobooks (MP3).")
    p.add_argument("sources", nargs="*", help="PDF/TXT paths, URLs, or arXiv IDs")
    p.add_argument("-o", "--output", help="Output MP3 (single source) or directory")
    p.add_argument("-v", "--voice", default=tts.DEFAULT_VOICE)
    p.add_argument("-s", "--speed", type=float, default=1.0, help="0.5 – 2.0")
    p.add_argument("--list-voices", metavar="LANG", nargs="?", const="en-",
                   help="List voices (optionally filtered, e.g. en-GB, hi-IN)")
    p.add_argument("--text-only", action="store_true", help="Only write the cleaned text")
    p.add_argument("--keep-references", action="store_true")
    p.add_argument("--keep-citations", action="store_true")
    p.add_argument("--keep-captions", action="store_true")
    p.add_argument("--skip-appendix", action="store_true")
    args = p.parse_args(argv)

    if args.list_voices is not None:
        for v in asyncio.run(tts.list_voices(args.list_voices)):
            print(f"{v['ShortName']:40} {v['Gender']:7} {v['Locale']}")
        return 0
    if not args.sources:
        p.error("give at least one source")

    opts = extract.Options(
        skip_references=not args.keep_references,
        remove_citations=not args.keep_citations,
        skip_captions=not args.keep_captions,
        skip_appendix=args.skip_appendix,
    )
    multi = len(args.sources) > 1
    out_dir = Path(args.output) if (args.output and multi) else Path.cwd()

    for src in args.sources:
        with tempfile.TemporaryDirectory() as tmp:
            path = extract.fetch(src, Path(tmp))
            doc = extract.load(path, opts)
        stem = re.sub(r"[^\w\-]+", "_", doc.title)[:80].strip("_") or "paper"
        target = Path(args.output) if (args.output and not multi) else out_dir / f"{stem}.mp3"
        print(f"{doc.title!r}: {len(doc.text.split())} words from {doc.pages} pages")

        if args.text_only:
            txt = target.with_suffix(".txt")
            txt.write_text(doc.text, encoding="utf-8")
            print(f"  wrote {txt}")
            continue

        def progress(done: int, total: int) -> None:
            print(f"\r  synthesizing {done}/{total}", end="", file=sys.stderr, flush=True)

        out = asyncio.run(tts.synthesize(doc.text, target, args.voice, args.speed, progress=progress))
        print(f"\n  wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
