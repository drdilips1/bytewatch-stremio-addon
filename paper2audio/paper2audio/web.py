"""Small web UI: upload a PDF or EPUB (or paste an arXiv link), get an MP3 back.

Run with:  python -m paper2audio.web   then open http://localhost:8000
"""

from __future__ import annotations

import asyncio
import os
import re
import threading
import uuid
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_file

from . import extract, tts

DATA_DIR = Path(os.environ.get("P2A_DATA_DIR", Path.home() / ".paper2audio"))
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

jobs: dict[str, dict] = {}
_voices: list[dict] = []


def _run_job(job_id: str, source: str, voice: str, speed: float, opts: extract.Options) -> None:
    job = jobs[job_id]
    workdir = DATA_DIR / job_id
    try:
        job["status"] = "extracting"
        path = extract.fetch(source, workdir)
        doc = extract.load(path, opts)
        job.update(title=doc.title, words=len(doc.text.split()), status="synthesizing")
        (workdir / "text.txt").write_text(doc.text, encoding="utf-8")

        def progress(done: int, total: int) -> None:
            job["progress"] = round(100 * done / total)

        out = asyncio.run(tts.synthesize(doc.text, workdir / "audio.mp3", voice, speed, progress=progress))
        job.update(status="done", audio=out.name)
    except Exception as exc:  # surfaced to the UI
        job.update(status="error", error=str(exc))


@app.get("/")
def index():
    global _voices
    if not _voices:
        _voices = asyncio.run(tts.list_voices())
    return render_template("index.html", voices=_voices, default_voice=tts.DEFAULT_VOICE)


@app.post("/api/jobs")
def create_job():
    job_id = uuid.uuid4().hex[:12]
    workdir = DATA_DIR / job_id
    workdir.mkdir(parents=True, exist_ok=True)

    upload = request.files.get("file")
    if upload and upload.filename:
        name = re.sub(r"[^\w.\-]+", "_", upload.filename)
        source = str(workdir / name)
        upload.save(source)
    else:
        source = (request.form.get("url") or "").strip()
        if not source.startswith(("http://", "https://")) and not extract.ARXIV_RE.match(source):
            return jsonify(error="Upload a file or give an http(s)/arXiv link"), 400

    try:
        speed = min(max(float(request.form.get("speed", 1.0)), 0.5), 2.0)
    except ValueError:
        speed = 1.0
    opts = extract.Options(
        skip_references=request.form.get("skip_references") == "on",
        remove_citations=request.form.get("remove_citations") == "on",
        skip_captions=request.form.get("skip_captions") == "on",
        skip_appendix=request.form.get("skip_appendix") == "on",
    )
    voice = request.form.get("voice") or tts.DEFAULT_VOICE
    jobs[job_id] = {"id": job_id, "status": "queued", "progress": 0, "title": None}
    threading.Thread(target=_run_job, args=(job_id, source, voice, speed, opts), daemon=True).start()
    return jsonify(jobs[job_id]), 202


@app.get("/api/jobs/<job_id>")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        abort(404)
    return jsonify(job)


@app.get("/api/jobs/<job_id>/<kind>")
def job_file(job_id: str, kind: str):
    job = jobs.get(job_id)
    if not job or kind not in {"audio", "text"}:
        abort(404)
    path = DATA_DIR / job_id / (job.get("audio", "audio.mp3") if kind == "audio" else "text.txt")
    if not path.exists():
        abort(404)
    stem = re.sub(r"[^\w\-]+", "_", job.get("title") or "paper")[:80].strip("_") or "paper"
    return send_file(path, download_name=f"{stem}{path.suffix}",
                     as_attachment=request.args.get("download") == "1")


def main() -> None:
    port = int(os.environ.get("PORT", 8000))
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=port, threaded=True)


if __name__ == "__main__":
    main()
