"""Small, single-user .vlx store for the private Pinloom deployment.

Nginx Basic Auth protects the public route. This process binds loopback only,
checks browser origins for writes, and writes complete JSON files atomically.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json
import os
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone


ROOT = Path(os.environ.get("PINLOOM_PROJECT_DIR", "/home/saimanoj/velxio-playground/projects"))
ORIGIN = os.environ.get("PINLOOM_ORIGIN", "https://playground.24-144-111-117.sslip.io")
PORT = int(os.environ.get("PINLOOM_PROJECT_PORT", "3081"))
MAX_BODY = 8 * 1024 * 1024
MAX_PROJECTS = 100
LOCK = threading.Lock()
ID_RE = re.compile(r"^/api/local-projects/([0-9a-f-]{36})$")


def project_path(project_id: str) -> Path:
    if str(uuid.UUID(project_id)) != project_id:
        raise ValueError("invalid project id")
    return ROOT / f"{project_id}.json"


def list_projects() -> list[dict]:
    items = []
    for path in ROOT.glob("*.json"):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            items.append({k: record[k] for k in ("id", "name", "updatedAt")})
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(items, key=lambda item: item["updatedAt"], reverse=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "PinloomProjectStore/1"

    def reply(self, status: int, payload: object) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def route(self) -> str | None:
        path = urlsplit(self.path).path
        if path == "/api/local-projects":
            return ""
        match = ID_RE.fullmatch(path)
        return match.group(1) if match else None

    def same_origin(self) -> bool:
        return self.headers.get("Origin") == ORIGIN

    def do_GET(self) -> None:
        project_id = self.route()
        if project_id is None:
            return self.reply(404, {"error": "Not found"})
        if not project_id:
            return self.reply(200, {"projects": list_projects()})
        try:
            record = json.loads(project_path(project_id).read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return self.reply(404, {"error": "Project not found"})
        return self.reply(200, record)

    def do_PUT(self) -> None:
        project_id = self.route()
        if not project_id:
            return self.reply(404, {"error": "Not found"})
        if not self.same_origin():
            return self.reply(403, {"error": "Origin rejected"})
        try:
            path = project_path(project_id)
            size = int(self.headers.get("Content-Length", "-1"))
            if size < 1 or size > MAX_BODY:
                return self.reply(413, {"error": "Project exceeds 8 MiB limit"})
            data = json.loads(self.rfile.read(size))
            name = data["name"]
            payload = data["project"]
            if not isinstance(name, str) or not (1 <= len(name.strip()) <= 120):
                raise ValueError("Project name must be 1–120 characters")
            if not isinstance(payload, dict) or payload.get("format") != "velxio-project" \
                    or payload.get("version") != 1 \
                    or not isinstance(payload.get("boards"), list) \
                    or not isinstance(payload.get("fileGroups"), dict) \
                    or not isinstance(payload.get("components"), list) \
                    or not isinstance(payload.get("wires"), list):
                raise ValueError("Invalid .vlx project")
            with LOCK:
                if not path.exists() and len(list_projects()) >= MAX_PROJECTS:
                    return self.reply(409, {"error": "Project limit reached"})
                record = {"id": project_id, "name": name.strip(),
                          "updatedAt": datetime.now(timezone.utc).isoformat(),
                          "project": payload}
                encoded = json.dumps(record, ensure_ascii=False).encode("utf-8")
                if len(encoded) > MAX_BODY:
                    return self.reply(413, {"error": "Project exceeds 8 MiB limit"})
                fd, temporary = tempfile.mkstemp(dir=ROOT, prefix=".saving-")
                try:
                    with os.fdopen(fd, "wb") as output:
                        output.write(encoded)
                        output.flush()
                        os.fsync(output.fileno())
                    os.replace(temporary, path)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            return self.reply(200, {k: record[k] for k in ("id", "name", "updatedAt")})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            return self.reply(400, {"error": str(exc)})

    def do_DELETE(self) -> None:
        project_id = self.route()
        if not project_id:
            return self.reply(404, {"error": "Not found"})
        if not self.same_origin():
            return self.reply(403, {"error": "Origin rejected"})
        try:
            with LOCK:
                project_path(project_id).unlink()
        except (ValueError, FileNotFoundError):
            return self.reply(404, {"error": "Project not found"})
        return self.reply(200, {"deleted": project_id})


if __name__ == "__main__":
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ROOT, 0o700)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
