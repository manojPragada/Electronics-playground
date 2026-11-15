"""Bounded diagnostic: replay the latest cached ESP32 firmware in QEMU.

Run inside the playground container. Reports only GPIO 33, LEDC duty/frequency,
GPIO routing, and boot status; does not print firmware or project contents.
"""
import glob
import json
import os
import select
import subprocess
import sys
import time

from app.services.esp32_lib_manager import lib_xtensa_path


def main() -> None:
    artifacts = glob.glob('/var/lib/velxio-build/artifacts/*.json')
    candidates = []
    for path in artifacts:
        with open(path) as f:
            artifact = json.load(f)
        if artifact.get('success') and artifact.get('binary_type') == 'bin':
            candidates.append((artifact.get('built_at') or 0, artifact['binary_content']))
    if not candidates:
        raise SystemExit('No cached ESP32 firmware')
    built_at, firmware = max(candidates)
    print('cached firmware built_at:', built_at, flush=True)
    config = {'lib_path': lib_xtensa_path(), 'firmware_b64': firmware,
              'machine': 'esp32-picsimlab', 'sensors': [], 'wifi_enabled': False}
    process = subprocess.Popen(
        [sys.executable, '/app/app/services/esp32_worker.py'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, bufsize=1, cwd='/app',
    )
    assert process.stdin and process.stdout
    process.stdin.write(json.dumps(config) + '\n')
    process.stdin.flush()
    deadline = time.monotonic() + 30
    counts = {}
    ledc = []
    routing = []
    pin33 = []
    system = []
    sequence = []
    try:
        while time.monotonic() < deadline and process.poll() is None:
            if not select.select([process.stdout], [], [], 0.25)[0]:
                continue
            line = process.stdout.readline()
            if not line:
                break
            try:
                event = json.loads(line)
            except ValueError:
                continue
            kind = event.get('type', '?')
            counts[kind] = counts.get(kind, 0) + 1
            if kind == 'ledc_duty' and len(ledc) < 30:
                ledc.append({k: event.get(k) for k in ('channel', 'duty_pct', 'freq_hz')})
            if kind in ('ledc_duty', 'gpio_routing', 'gpio_routing_clear') and len(sequence) < 35:
                sequence.append(event)
            if kind == 'gpio_routing' and event.get('gpio') == 33 and len(routing) < 10:
                routing.append(event)
            if kind == 'gpio_change' and event.get('pin') == 33 and len(pin33) < 20:
                pin33.append(event.get('state'))
            if kind in ('system', 'error') and len(system) < 12:
                system.append(event)
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
    print(json.dumps({'counts': counts, 'ledc': ledc, 'gpio33_routing': routing,
                      'gpio33_edges': pin33, 'system': system,
                      'sequence': sequence}), flush=True)


if __name__ == '__main__':
    main()
