"""Runtime part library: validation, sanitising, storage, export."""
import json

import pytest

from app.services import part_library as pl


def _part(**over):
    base = {
        "id": "test-module",
        "name": "Test Module",
        "category": "communication",
        "pins": [{"name": "GND", "x": 20, "y": 20}, {"name": "VCC", "x": 60, "y": 20}],
        "body": {"width": 100, "height": 80},
    }
    base.update(over)
    return base


@pytest.fixture(autouse=True)
def _dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("VELXIO_PARTS_DIR", str(tmp_path / "parts"))
    monkeypatch.setenv("VELXIO_STATIC_PARTS_FILE", str(tmp_path / "static" / "index.json"))


def test_valid_part_round_trips():
    saved = pl.save_part(_part(tags=["lora"], keywords=["radio"]))
    assert saved["id"] == "test-module"
    assert [p["id"] for p in pl.list_parts()] == ["test-module"]
    assert pl.list_parts()[0]["pins"][0] == {"name": "GND", "x": 20, "y": 20}


def test_redefining_replaces():
    pl.save_part(_part())
    pl.save_part(_part(name="Renamed"))
    parts = pl.list_parts()
    assert len(parts) == 1 and parts[0]["name"] == "Renamed"


@pytest.mark.parametrize(
    "bad,fragment",
    [
        ({"id": "Bad Id"}, "id must be"),
        ({"id": "../etc"}, "id must be"),
        ({"name": ""}, "name is required"),
        ({"category": "nope"}, "category must be"),
        ({"pins": []}, "pins must be"),
        ({"pins": [{"name": "A", "x": 1, "y": 1}, {"name": "A", "x": 2, "y": 2}]}, "duplicate"),
        ({"pins": [{"name": "bad name!", "x": 1, "y": 1}]}, "name must be"),
        ({"pins": [{"name": "A", "x": -1, "y": 1}]}, "between 0 and"),
        ({"pins": [{"name": "A", "x": True, "y": 1}]}, "between 0 and"),
        ({"pins": [{"name": "A", "x": 500, "y": 1}]}, "outside the body"),
        ({"body": {"width": 5, "height": 80}}, "body.width"),
        ({"face_svg": "<svg/>", "body": None}, "needs body"),
        ({"face_svg": "not svg"}, "must be SVG"),
        ({"source_c": 5}, "source_c must be"),
        ({"tags": "lora"}, "list of strings"),
    ],
)
def test_rejects(bad, fragment):
    raw = _part(**bad)
    if bad.get("body", 1) is None:
        raw.pop("body")
    with pytest.raises(pl.PartError, match=fragment):
        pl.validate_part(raw)


def test_size_caps():
    with pytest.raises(pl.PartError, match="face_svg is larger"):
        pl.validate_part(_part(face_svg="<svg>" + "x" * 250_000 + "</svg>"))
    with pytest.raises(pl.PartError, match="source_c is larger"):
        pl.validate_part(_part(source_c="x" * 500_000))


def test_face_is_sanitised():
    dirty = (
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'
        "<script>alert(1)</script><foreignObject><div/></foreignObject>"
        '<rect onclick="x()" width="5" height="5"/>'
        '<image href="http://evil.example/a.png"/>'
        '<image href="data:image/png;base64,AAAA"/>'
        '<use href="#a"/></svg>'
    )
    clean = pl.validate_part(_part(face_svg=dirty))["face_svg"]
    low = clean.lower()
    assert "script" not in low and "foreignobject" not in low
    assert "onload" not in low and "onclick" not in low
    assert "evil.example" not in low
    assert "data:image/png" in low and 'href="#a"' in low


def test_delete():
    pl.save_part(_part())
    assert pl.delete_part("test-module") is True
    assert pl.delete_part("test-module") is False
    with pytest.raises(pl.PartError):
        pl.delete_part("../x")


def test_list_skips_broken_files(tmp_path):
    pl.save_part(_part())
    (pl.parts_dir() / "junk.json").write_text("{not json")
    (pl.parts_dir() / "empty.json").write_text("{}")
    assert [p["id"] for p in pl.list_parts()] == ["test-module"]


def test_export_merges_with_shipped_parts(tmp_path):
    static = pl.static_parts_file()
    static.parent.mkdir(parents=True)
    shipped = pl.validate_part(_part(id="shipped-part", name="Shipped"))
    static.write_text(json.dumps({"parts": [shipped, {"id": "garbage"}]}))
    pl.save_part(_part())
    path, count = pl.export_to_static()
    ids = sorted(p["id"] for p in json.loads(path.read_text())["parts"])
    assert ids == ["shipped-part", "test-module"] and count == 2
    # a library part replaces the shipped one with the same id
    pl.save_part(_part(id="shipped-part", name="Newer"))
    path, _ = pl.export_to_static()
    names = {p["id"]: p["name"] for p in json.loads(path.read_text())["parts"]}
    assert names["shipped-part"] == "Newer"


def test_auto_export_mirrors_changes_and_keeps_shipped_parts(tmp_path, monkeypatch):
    shipped_file = tmp_path / "dist" / "index.json"
    shipped_file.parent.mkdir()
    shipped_file.write_text(json.dumps({"parts": [pl.validate_part(_part(id="shipped-part", name="Shipped"))]}))
    monkeypatch.setenv("VELXIO_SHIPPED_PARTS_FILE", str(shipped_file))
    monkeypatch.setenv("VELXIO_AUTO_EXPORT", "1")

    ids = lambda: sorted(p["id"] for p in json.loads(pl.static_parts_file().read_text())["parts"])  # noqa: E731
    pl.save_part(_part())
    assert ids() == ["shipped-part", "test-module"]
    pl.delete_part("test-module")
    assert ids() == ["shipped-part"]


def test_no_auto_export_unless_enabled():
    pl.save_part(_part())
    assert not pl.static_parts_file().exists()
