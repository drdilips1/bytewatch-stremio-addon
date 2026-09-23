# Paper to Audio (self-hosted, unlimited)

Turn research papers and PDFs into audio you can listen to, similar to
paper2audio.com. It runs on your own machine, so there are no page limits,
monthly quotas or accounts.

## What it does

- Reads a **PDF, TXT or Markdown** file, a **PDF link**, or an **arXiv ID** such as `1706.03762`.
- Cleans the text so it sounds good read aloud:
  - removes running headers, footers and page numbers
  - joins words split by hyphens at line ends (`atten-` / `tion` becomes `attention`)
  - removes inline citations (`[1, 2]`, `(Smith et al., 2020)`) and URLs
  - skips figure and table captions, equations and number-heavy fragments
  - stops at **References** or **Bibliography**; optionally also skips the appendix
  - skips acknowledgements
  - expands `e.g.`, `i.e.`, `%`, `≈`, `±` and similar into spoken words
- Converts the text to natural-sounding speech with adjustable speed (0.5× to 2×) and many voices.
- Offers a web page (upload a file, then listen or download the MP3) and a command-line tool.

### Voice engines (both free, no limits)

| Engine | Voices | Needs internet | Notes |
|---|---|---|---|
| **Edge** (default) | 400+ neural voices, 100+ languages (for example `en-US-AndrewMultilingualNeural`, `en-GB-SoniaNeural`, `hi-IN-SwaraNeural`) | Yes | Microsoft's free "Read aloud" voices. No API key needed. |
| **Piper** | `piper:en_US-lessac-medium`, `piper:en_US-ryan-high`, and [many more](https://huggingface.co/rhasspy/piper-voices) | Only to download a voice once | Runs fully offline on your CPU. Needs `ffmpeg` for MP3 output; otherwise it writes WAV. |

## Install

Requires Python 3.10 or newer.

```bash
cd paper2audio
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Web app

```bash
python -m paper2audio.web
# open http://localhost:8000
```

Set `HOST=0.0.0.0` to open it to other devices on your network, and
`P2A_DATA_DIR` to choose where uploads and audio are stored (default `~/.paper2audio`).

With Docker (ffmpeg included):

```bash
docker build -t paper2audio .
docker run -p 8000:8000 -v p2a-data:/data paper2audio
```

## Command line

```bash
# one paper to MP3
python -m paper2audio.cli paper.pdf -o paper.mp3

# from arXiv, faster, British voice
python -m paper2audio.cli 1706.03762 -v en-GB-RyanNeural -s 1.3

# many papers at once into a folder
python -m paper2audio.cli a.pdf b.pdf https://example.org/c.pdf -o audiobooks/

# fully offline voice
python -m paper2audio.cli paper.pdf -v piper:en_US-lessac-medium

# list voices (optionally by language)
python -m paper2audio.cli --list-voices en-GB

# only save the cleaned text, to check what will be read aloud
python -m paper2audio.cli paper.pdf --text-only
```

Options: `--keep-references`, `--keep-citations`, `--keep-captions`, `--skip-appendix`.

## Limitations

- Equations are skipped, not spoken as math.
- Complex multi-column layouts can occasionally read out of order. Use `--text-only` to check.
- Scanned PDFs (images with no text layer) need OCR first, for example `ocrmypdf in.pdf out.pdf`.
