"""
Part library: parts (modules, breakouts, small boards) defined at runtime.

A *part* is a picker entry plus a face and a pin list, optionally with C source
that simulates it. The MCP server writes parts here (``define_part``); the
frontend reads them back through ``GET /api/parts`` and offers them in the
Add Component picker, with no rebuild. ``export_to_static`` writes the same
parts into ``frontend/public/parts/index.json`` so a normal frontend build
(and the hosted site) ships them too.

What a part can be: anything the custom-chip pipeline can draw and wire up
(explicit pin positions, a face image, optional C simulation model). What it
cannot be: a new CPU. Emulated boards need an emulator, which lives in code.

Everything here is plain data validation. Nothing is executed: the C source
is only compiled later, by the existing chip compiler, when someone presses Run.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

# Keep in step with frontend/src/types/component-metadata.ts ComponentCategory.
CATEGORIES = frozenset(
    {
        "boards", "sensors", "displays", "input", "output", "motors",
        "communication", "connectivity", "passive", "logic", "analog",
        "electromech", "other",
    }
)

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}$")
PIN_RE = re.compile(r"^[A-Za-z0-9_.+/\-]{1,24}$")

MAX_FACE_BYTES = 200_000
MAX_SOURCE_BYTES = 400_000
MAX_PINS = 128
MAX_COORD = 2000


class PartError(ValueError):
    """The part definition is invalid; the message says what to fix."""


def parts_dir() -> Path:
    env = os.environ.get("VELXIO_PARTS_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "data" / "parts"


def auto_export_enabled() -> bool:
    """VELXIO_AUTO_EXPORT=1 mirrors every change into the static parts file.

    On the server that file is the one nginx serves as /parts/index.json, so a
    part defined over MCP is in the picker as soon as the editor reopens it.
    """
    return os.environ.get("VELXIO_AUTO_EXPORT", "").strip().lower() in {"1", "true", "yes", "on"}


def shipped_parts_file() -> Path | None:
    """The parts a build ships (dist/parts/index.json); merged under the library on export."""
    env = os.environ.get("VELXIO_SHIPPED_PARTS_FILE")
    return Path(env) if env else None


def static_parts_file() -> Path:
    """frontend/public/parts/index.json, next to the backend in a checkout."""
    env = os.environ.get("VELXIO_STATIC_PARTS_FILE")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[3] / "frontend" / "public" / "parts" / "index.json"


# --------------------------------------------------------------------------
# Face SVG sanitising
# --------------------------------------------------------------------------

_SCRIPT_RE = re.compile(r"<\s*(script|foreignObject|iframe|object|embed)\b.*?<\s*/\s*\1\s*>", re.I | re.S)
_SELF_CLOSING_BAD_RE = re.compile(r"<\s*(script|foreignObject|iframe|object|embed)\b[^>]*/\s*>", re.I)
_EVENT_ATTR_RE = re.compile(r"""\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.I)
_HREF_RE = re.compile(r"""\s(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')""", re.I)


def sanitize_face_svg(svg: str) -> str:
    """Return the SVG with active content removed.

    The face is shown through an <image> element, where scripts do not run, so
    this is defence in depth: it drops script-like elements, ``on*`` handlers
    and any href that is not a local ``#id`` reference or a ``data:image``
    URL. It is not a general SVG sanitiser and does not try to be.
    """
    if not isinstance(svg, str) or "<svg" not in svg.lower():
        raise PartError("face_svg must be SVG markup containing an <svg> element")
    if len(svg.encode("utf-8")) > MAX_FACE_BYTES:
        raise PartError(f"face_svg is larger than {MAX_FACE_BYTES} bytes")
    out = _SCRIPT_RE.sub("", svg)
    out = _SELF_CLOSING_BAD_RE.sub("", out)
    out = _EVENT_ATTR_RE.sub("", out)

    def _href(m: re.Match[str]) -> str:
        target = m.group(2) if m.group(2) is not None else m.group(3)
        if target.startswith("#") or target.lower().startswith("data:image/"):
            return m.group(0)
        return ""

    return _HREF_RE.sub(_href, out)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------


def _str(raw: dict[str, Any], key: str, limit: int, *, required: bool = False) -> str:
    v = raw.get(key, "")
    if v is None:
        v = ""
    if not isinstance(v, str):
        raise PartError(f"{key} must be a string")
    v = v.strip()
    if required and not v:
        raise PartError(f"{key} is required")
    if len(v) > limit:
        raise PartError(f"{key} is longer than {limit} characters")
    return v


def _words(raw: dict[str, Any], key: str, max_items: int, max_len: int) -> list[str]:
    v = raw.get(key) or []
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise PartError(f"{key} must be a list of strings")
    if len(v) > max_items:
        raise PartError(f"{key} has more than {max_items} entries")
    return [x.strip()[:max_len] for x in v if x.strip()]


def validate_part(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalise a part definition. Raises PartError."""
    if not isinstance(raw, dict):
        raise PartError("a part must be an object")

    part_id = _str(raw, "id", 49, required=True)
    if not ID_RE.match(part_id):
        raise PartError("id must be lowercase letters, digits and dashes, 2-49 characters, e.g. 'e22-lora-module'")

    category = _str(raw, "category", 20) or "other"
    if category not in CATEGORIES:
        raise PartError(f"category must be one of: {', '.join(sorted(CATEGORIES))}")

    pins_in = raw.get("pins")
    if not isinstance(pins_in, list) or not pins_in:
        raise PartError("pins must be a non-empty list of {name, x, y}")
    if len(pins_in) > MAX_PINS:
        raise PartError(f"at most {MAX_PINS} pins")
    pins: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, p in enumerate(pins_in):
        if not isinstance(p, dict):
            raise PartError(f"pins[{i}] must be an object {{name, x, y}}")
        name = p.get("name")
        if not isinstance(name, str) or not PIN_RE.match(name):
            raise PartError(f"pins[{i}].name must be 1-24 characters of letters, digits and _ . + / -")
        if name in seen:
            raise PartError(f"duplicate pin name '{name}'")
        seen.add(name)
        x, y = p.get("x"), p.get("y")
        for label, c in (("x", x), ("y", y)):
            if isinstance(c, bool) or not isinstance(c, (int, float)) or not (0 <= c <= MAX_COORD):
                raise PartError(f"pins[{i}].{label} must be a number between 0 and {MAX_COORD}")
        pins.append({"name": name, "x": round(float(x)), "y": round(float(y))})

    body = raw.get("body")
    if body is not None:
        if not isinstance(body, dict):
            raise PartError("body must be {width, height}")
        w, h = body.get("width"), body.get("height")
        for label, c in (("width", w), ("height", h)):
            if isinstance(c, bool) or not isinstance(c, (int, float)) or not (20 <= c <= MAX_COORD):
                raise PartError(f"body.{label} must be a number between 20 and {MAX_COORD}")
        body = {"width": round(float(w)), "height": round(float(h))}
        for p in pins:
            if p["x"] > body["width"] or p["y"] > body["height"]:
                raise PartError(f"pin '{p['name']}' lies outside the body ({body['width']}x{body['height']})")

    face = raw.get("face_svg")
    if face:
        if body is None:
            raise PartError("a part with a face_svg needs body {width, height} so the face lines up with the pins")
        face = sanitize_face_svg(face)
    else:
        face = ""

    source = raw.get("source_c") or ""
    if not isinstance(source, str):
        raise PartError("source_c must be a string of C source")
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise PartError(f"source_c is larger than {MAX_SOURCE_BYTES} bytes")

    part: dict[str, Any] = {
        "id": part_id,
        "name": _str(raw, "name", 80, required=True),
        "description": _str(raw, "description", 600),
        "category": category,
        "tags": _words(raw, "tags", 16, 32),
        "keywords": _words(raw, "keywords", 24, 80),
        "pins": pins,
    }
    if body:
        part["body"] = body
    if face:
        part["face_svg"] = face
    if source:
        part["source_c"] = source
    return part


# --------------------------------------------------------------------------
# Storage
# --------------------------------------------------------------------------


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        finally:
            raise


def save_part(raw: dict[str, Any]) -> dict[str, Any]:
    part = validate_part(raw)
    _atomic_write(parts_dir() / f"{part['id']}.json", json.dumps(part, indent=2))
    if auto_export_enabled():
        export_to_static()
    return part


def list_parts() -> list[dict[str, Any]]:
    d = parts_dir()
    if not d.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for f in sorted(d.glob("*.json")):
        try:
            out.append(validate_part(json.loads(f.read_text(encoding="utf-8"))))
        except (OSError, ValueError):
            continue  # a hand-edited or half-written file never breaks the list
    return out


def delete_part(part_id: str) -> bool:
    if not ID_RE.match(part_id or ""):
        raise PartError("invalid id")
    f = parts_dir() / f"{part_id}.json"
    if not f.is_file():
        return False
    f.unlink()
    if auto_export_enabled():
        export_to_static(drop=part_id)
    return True


def _read_parts_file(path: Path | None) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if path is None or not path.is_file():
        return out
    try:
        for p in json.loads(path.read_text(encoding="utf-8")).get("parts", []):
            try:
                v = validate_part(p)
                out[v["id"]] = v
            except PartError:
                continue
    except (OSError, ValueError):
        pass
    return out


def export_to_static(drop: str | None = None) -> tuple[Path, int]:
    """Merge the library into the static parts file (frontend/public/parts/index.json).

    Precedence, lowest first: parts a build ships (VELXIO_SHIPPED_PARTS_FILE),
    parts already in the target file, then the library. ``drop`` removes one id
    afterwards (used when a part is deleted). Returns (path, total parts written).
    """
    target = static_parts_file()
    merged = _read_parts_file(shipped_parts_file())
    merged.update(_read_parts_file(target))
    for p in list_parts():
        merged[p["id"]] = p
    if drop:
        merged.pop(drop, None)
    _atomic_write(target, json.dumps({"parts": list(merged.values())}, indent=1))
    return target, len(merged)
