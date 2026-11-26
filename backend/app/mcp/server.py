"""
Velxio MCP Server

Exposes the following tools to MCP-compatible agents (e.g. Claude):

  - compile_project       Compile Arduino sketch files → hex / binary
  - run_project           Compile and return simulation-ready artifacts
  - import_wokwi_json     Parse a Wokwi diagram.json → Velxio circuit
  - export_wokwi_json     Serialise a Velxio circuit → Wokwi diagram.json
  - create_circuit        Create a new circuit definition
  - update_circuit        Merge changes into an existing circuit definition
  - generate_code_files   Generate starter Arduino code from a circuit
  - define_part           Define a new module/breakout/board part (pins, face, optional C model)
  - list_parts            List parts defined so far
  - delete_part           Remove a defined part
  - export_parts_for_deploy  Write parts into frontend/public/parts so a build ships them

Transport:
  - stdio  — run `python mcp_server.py` for Claude Desktop / CLI agents
  - SSE    — mounted at /mcp in the FastAPI app for HTTP-based agents
"""

from __future__ import annotations

import json
import sys
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP

from app.mcp.wokwi import (
    format_wokwi_diagram,
    generate_arduino_sketch,
    parse_wokwi_diagram,
)
from app.services import part_library
from app.services.arduino_cli import ArduinoCLIService

# ---------------------------------------------------------------------------
# Server setup
# ---------------------------------------------------------------------------

mcp = FastMCP(
    name="velxio",
    instructions=(
        "Velxio MCP server — create circuits, import/export Wokwi JSON, "
        "generate Arduino code, and compile projects."
    ),
)

_arduino = ArduinoCLIService()

# ---------------------------------------------------------------------------
# compile_project
# ---------------------------------------------------------------------------


@mcp.tool()
async def compile_project(
    files: Annotated[
        list[dict[str, str]],
        "List of source files. Each item must have 'name' (filename, e.g. 'sketch.ino') "
        "and 'content' (file text).",
    ],
    board: Annotated[
        str,
        "Arduino board FQBN, e.g. 'arduino:avr:uno' or 'rp2040:rp2040:rpipico'. "
        "Defaults to 'arduino:avr:uno'.",
    ] = "arduino:avr:uno",
) -> dict[str, Any]:
    """
    Compile one or more Arduino sketch files and return the compiled artifact.

    Returns a dict with:
      - success (bool)
      - hex_content (str | null)    Intel HEX for AVR boards
      - binary_content (str | null) Base-64 .bin/.uf2 for RP2040
      - binary_type (str | null)    'bin' or 'uf2'
      - uf2_content (str | null)   Base-64 .uf2 for RP2040/RP2350 (hardware flash)
      - stdout (str)
      - stderr (str)
      - error (str | null)
    """
    for f in files:
        if "name" not in f or "content" not in f:
            return {
                "success": False,
                "error": "Each file entry must have 'name' and 'content' keys.",
                "stdout": "",
                "stderr": "",
            }

    try:
        result = await _arduino.compile(files, board)
        return result
    except Exception as exc:  # pragma: no cover
        return {
            "success": False,
            "error": str(exc),
            "stdout": "",
            "stderr": "",
        }


# ---------------------------------------------------------------------------
# run_project
# ---------------------------------------------------------------------------


@mcp.tool()
async def run_project(
    files: Annotated[
        list[dict[str, str]],
        "List of source files (same format as compile_project).",
    ],
    board: Annotated[str, "Board FQBN (default: 'arduino:avr:uno')."] = "arduino:avr:uno",
) -> dict[str, Any]:
    """
    Compile the project and return simulation-ready artifacts.

    The Velxio frontend can load the returned hex_content / binary_content
    directly into its AVR / RP2040 emulator.  Actual execution happens
    client-side in the browser.

    Returns the same payload as compile_project plus a 'simulation_ready' flag.
    """
    result = await compile_project(files=files, board=board)
    result["simulation_ready"] = result.get("success", False)
    return result


# ---------------------------------------------------------------------------
# import_wokwi_json
# ---------------------------------------------------------------------------


@mcp.tool()
async def import_wokwi_json(
    diagram_json: Annotated[
        str,
        "Wokwi diagram.json content as a JSON string. "
        "Must contain at minimum a 'parts' array.",
    ],
) -> dict[str, Any]:
    """
    Parse a Wokwi diagram.json payload and return a Velxio circuit object.

    The returned circuit can be passed directly to export_wokwi_json,
    generate_code_files, compile_project, or saved as a Velxio project.

    Returns:
      - board_fqbn (str)         Detected Arduino board FQBN
      - components (list)        List of component objects
      - connections (list)       List of connection objects
      - version (int)
    """
    try:
        diagram = json.loads(diagram_json)
    except json.JSONDecodeError as exc:
        return {"error": f"Invalid JSON: {exc}"}

    if not isinstance(diagram, dict):
        return {"error": "diagram_json must be a JSON object."}

    return parse_wokwi_diagram(diagram)


# ---------------------------------------------------------------------------
# export_wokwi_json
# ---------------------------------------------------------------------------


@mcp.tool()
async def export_wokwi_json(
    circuit: Annotated[
        dict[str, Any],
        "Velxio circuit object with 'components', 'connections', and 'board_fqbn'.",
    ],
    author: Annotated[str, "Author name to embed in the diagram (default: 'velxio')."] = "velxio",
) -> dict[str, Any]:
    """
    Convert a Velxio circuit object into a Wokwi diagram.json payload.

    The returned payload is compatible with the Wokwi simulator and can be
    imported using the Wokwi zip import feature in Velxio.

    Returns the Wokwi diagram dict (version, author, editor, parts, connections).
    """
    if not isinstance(circuit, dict):
        return {"error": "circuit must be a JSON object."}

    return format_wokwi_diagram(circuit, author=author)


# ---------------------------------------------------------------------------
# create_circuit
# ---------------------------------------------------------------------------


@mcp.tool()
async def create_circuit(
    board_fqbn: Annotated[
        str,
        "Arduino board FQBN. e.g. 'arduino:avr:uno', 'rp2040:rp2040:rpipico'.",
    ] = "arduino:avr:uno",
    components: Annotated[
        list[dict[str, Any]] | None,
        "List of component objects. Each item may have: "
        "id (str), type (str, Wokwi element type), left (number), top (number), "
        "rotate (number), attrs (object).",
    ] = None,
    connections: Annotated[
        list[dict[str, Any]] | None,
        "List of connection objects. Each item may have: "
        "from_part (str), from_pin (str), to_part (str), to_pin (str), color (str).",
    ] = None,
) -> dict[str, Any]:
    """
    Create a new Velxio circuit definition.

    Example component types: wokwi-led, wokwi-pushbutton, wokwi-resistor,
    wokwi-buzzer, wokwi-servo, wokwi-lcd1602.

    Example connection:
      { "from_part": "uno", "from_pin": "13", "to_part": "led1", "to_pin": "A",
        "color": "green" }

    Returns the new circuit object (board_fqbn, components, connections, version).
    """
    components_list = components if components is not None else []
    connections_list = connections if connections is not None else []

    # Normalise components
    normalised_components: list[dict[str, Any]] = []
    for i, comp in enumerate(components_list):
        normalised_components.append(
            {
                "id": comp.get("id", f"comp{i}"),
                "type": comp.get("type", ""),
                "left": float(comp.get("left", 0)),
                "top": float(comp.get("top", 0)),
                "rotate": int(comp.get("rotate", 0)),
                "attrs": dict(comp.get("attrs", {})),
            }
        )

    # Normalise connections
    normalised_connections: list[dict[str, Any]] = []
    for conn in connections_list:
        normalised_connections.append(
            {
                "from_part": conn.get("from_part", ""),
                "from_pin": conn.get("from_pin", ""),
                "to_part": conn.get("to_part", ""),
                "to_pin": conn.get("to_pin", ""),
                "color": conn.get("color", "green"),
            }
        )

    return {
        "board_fqbn": board_fqbn,
        "components": normalised_components,
        "connections": normalised_connections,
        "version": 1,
    }


# ---------------------------------------------------------------------------
# update_circuit
# ---------------------------------------------------------------------------


@mcp.tool()
async def update_circuit(
    circuit: Annotated[
        dict[str, Any],
        "Existing Velxio circuit object to update.",
    ],
    add_components: Annotated[
        list[dict[str, Any]] | None,
        "Components to add. Merged after existing components.",
    ] = None,
    remove_component_ids: Annotated[
        list[str] | None,
        "IDs of components to remove.",
    ] = None,
    add_connections: Annotated[
        list[dict[str, Any]] | None,
        "Connections to add.",
    ] = None,
    remove_connections: Annotated[
        list[dict[str, Any]] | None,
        "Connections to remove (matched by from_part+from_pin+to_part+to_pin).",
    ] = None,
    board_fqbn: Annotated[
        str | None,
        "If provided, replaces the circuit board_fqbn.",
    ] = None,
) -> dict[str, Any]:
    """
    Merge changes into an existing Velxio circuit definition.

    Supports adding/removing components and connections, and changing the board.

    Returns the updated circuit object.
    """
    if not isinstance(circuit, dict):
        return {"error": "circuit must be a JSON object."}

    import copy

    updated = copy.deepcopy(circuit)

    if board_fqbn is not None:
        updated["board_fqbn"] = board_fqbn

    # Remove components
    if remove_component_ids:
        remove_set = set(remove_component_ids)
        updated["components"] = [
            c for c in updated.get("components", []) if c.get("id") not in remove_set
        ]

    # Add components
    existing_ids = {c.get("id") for c in updated.get("components", [])}
    for i, comp in enumerate(add_components or []):
        comp_id = comp.get("id", f"comp_new_{i}")
        if comp_id in existing_ids:
            comp_id = f"{comp_id}_new"
        updated.setdefault("components", []).append(
            {
                "id": comp_id,
                "type": comp.get("type", ""),
                "left": float(comp.get("left", 0)),
                "top": float(comp.get("top", 0)),
                "rotate": int(comp.get("rotate", 0)),
                "attrs": dict(comp.get("attrs", {})),
            }
        )

    # Remove connections (exact match)
    if remove_connections:
        def _conn_key(c: dict[str, Any]) -> tuple[str, str, str, str]:
            return (
                c.get("from_part", ""),
                c.get("from_pin", ""),
                c.get("to_part", ""),
                c.get("to_pin", ""),
            )

        remove_keys = {_conn_key(c) for c in remove_connections}
        updated["connections"] = [
            c for c in updated.get("connections", []) if _conn_key(c) not in remove_keys
        ]

    # Add connections
    for conn in (add_connections or []):
        updated.setdefault("connections", []).append(
            {
                "from_part": conn.get("from_part", ""),
                "from_pin": conn.get("from_pin", ""),
                "to_part": conn.get("to_part", ""),
                "to_pin": conn.get("to_pin", ""),
                "color": conn.get("color", "green"),
            }
        )

    return updated


# ---------------------------------------------------------------------------
# generate_code_files
# ---------------------------------------------------------------------------


@mcp.tool()
async def generate_code_files(
    circuit: Annotated[
        dict[str, Any],
        "Velxio circuit object (from create_circuit or import_wokwi_json).",
    ],
    sketch_name: Annotated[
        str,
        "Base name for the generated sketch file (without extension).",
    ] = "sketch",
    extra_instructions: Annotated[
        str,
        "Optional extra instructions or comments to embed in the sketch.",
    ] = "",
) -> dict[str, Any]:
    """
    Generate starter Arduino code files for the given circuit.

    Returns:
      - files: list of { "name": str, "content": str } — ready for compile_project
      - board_fqbn: str — detected board FQBN
    """
    if not isinstance(circuit, dict):
        return {"error": "circuit must be a JSON object."}

    sketch_content = generate_arduino_sketch(circuit, sketch_name=sketch_name)

    if extra_instructions:
        header = f"// {extra_instructions}\n"
        sketch_content = header + sketch_content

    board_fqbn: str = circuit.get("board_fqbn", "arduino:avr:uno")

    return {
        "files": [{"name": f"{sketch_name}.ino", "content": sketch_content}],
        "board_fqbn": board_fqbn,
    }


# ---------------------------------------------------------------------------
# Runtime part library: define_part / list_parts / delete_part / export
# ---------------------------------------------------------------------------


@mcp.tool()
async def define_part(
    id: Annotated[str, "Lowercase id with dashes, e.g. 'e22-lora-module'. Defining the same id again replaces the part."],
    name: Annotated[str, "Name shown in the picker, e.g. 'E22 LoRa Module (SX1262)'."],
    pins: Annotated[
        list[dict[str, Any]],
        "Every wireable pad as {name, x, y}. x and y are pixels from the TOP-LEFT of the body "
        "(same coordinate space as face_svg). Names are what wires and C source refer to "
        "(use the silkscreen names printed on the real part).",
    ],
    body: Annotated[
        dict[str, Any] | None,
        "{width, height} of the part in pixels. Required when face_svg is given. "
        "Typical: a 2x6 header at 20px pitch needs about 120 x 230.",
    ] = None,
    face_svg: Annotated[
        str | None,
        "Optional artwork: a complete <svg> whose coordinates are the BODY coordinates "
        "(0,0 top-left, body.width x body.height). Draw the PCB, the chip, connectors; the pins "
        "and their labels are drawn on top automatically. No scripts or external links.",
    ] = None,
    description: Annotated[str, "One or two sentences for the picker card."] = "",
    category: Annotated[
        str,
        "Picker category: boards, sensors, displays, input, output, motors, communication, "
        "connectivity, passive, logic, analog, electromech or other.",
    ] = "other",
    tags: Annotated[list[str] | None, "Short search tags, e.g. ['lora','radio']."] = None,
    keywords: Annotated[list[str] | None, "Extra search words (not shown), e.g. alternative part names."] = None,
    source_c: Annotated[
        str | None,
        "Optional C source that simulates the part (Velxio custom-chip API, velxio-chip.h). "
        "Pins are looked up by name with vx_pin_register(\"NAME\", ...), so names must match "
        "`pins`. Omit for a part that is only a wiring/visual breakout. It is compiled when "
        "someone presses Run, not here.",
    ] = None,
) -> dict[str, Any]:
    """
    Define a new part (module, breakout or small carrier board) that appears in the
    Add Component picker immediately, with no rebuild or redeploy.

    Use this instead of asking a developer to add a component. The part is a custom
    chip underneath: explicit pin positions, optional face artwork, optional C
    simulation. It can NOT define a new CPU/MCU: emulated boards live in code. To put a
    module's behaviour in the simulator, either reuse an existing chip model's source or
    write source_c.

    After defining, tell the user to open Add Component and search for the part name.
    Call export_parts_for_deploy when the part should ship with a build (hosted site).
    """
    raw: dict[str, Any] = {
        "id": id,
        "name": name,
        "pins": pins,
        "description": description,
        "category": category,
        "tags": tags or [],
        "keywords": keywords or [],
    }
    if body is not None:
        raw["body"] = body
    if face_svg:
        raw["face_svg"] = face_svg
    if source_c:
        raw["source_c"] = source_c
    try:
        part = part_library.save_part(raw)
    except part_library.PartError as exc:
        return {"success": False, "error": str(exc)}
    return {
        "success": True,
        "id": part["id"],
        "pins": [p["name"] for p in part["pins"]],
        "has_face": "face_svg" in part,
        "has_model": "source_c" in part,
        "stored_in": str(part_library.parts_dir()),
        "next": f"Open Add Component and search '{part['name']}'. Refresh the editor tab if it was already open.",
    }


@mcp.tool()
async def list_parts() -> dict[str, Any]:
    """List the parts defined with define_part (id, name, category, pin names)."""
    return {
        "parts": [
            {
                "id": p["id"],
                "name": p["name"],
                "category": p["category"],
                "pins": [pin["name"] for pin in p["pins"]],
                "has_face": "face_svg" in p,
                "has_model": "source_c" in p,
            }
            for p in part_library.list_parts()
        ]
    }


@mcp.tool()
async def delete_part(id: Annotated[str, "Id of the part to remove."]) -> dict[str, Any]:
    """Remove a part defined with define_part. Parts already exported to the repo are not touched."""
    try:
        removed = part_library.delete_part(id)
    except part_library.PartError as exc:
        return {"success": False, "error": str(exc)}
    return {"success": True, "removed": removed}


@mcp.tool()
async def export_parts_for_deploy() -> dict[str, Any]:
    """
    Write every defined part into frontend/public/parts/index.json (merged with the parts
    the repo already ships). Commit that file and rebuild the frontend so the hosted site
    offers the parts too. Does not commit, push or deploy anything.
    """
    try:
        path, count = part_library.export_to_static()
    except OSError as exc:
        return {"success": False, "error": f"could not write the parts file: {exc}"}
    return {
        "success": True,
        "file": str(path),
        "parts_in_file": count,
        "next": "git add frontend/public/parts/index.json, commit, then rebuild and upload the frontend.",
    }

