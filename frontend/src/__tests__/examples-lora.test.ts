// @vitest-environment jsdom
/**
 * The LoRa two-node example wires only to pins that exist.
 *
 * Board pins come from the ESP32 element, chip pins from the SX1262 chip JSON,
 * the OLED's from its element. A wrong name leaves a wire dangling on the
 * canvas, which is invisible to every netlist test.
 */
import { describe, it, expect } from 'vitest';
import '../components/velxio-components/Esp32Element';
import '../components/velxio-components/Ssd1306I2cElement';
import { exampleProjects } from '../data/examples';
import sx1262J from '../components/customChips/examples/sx1262.chip.json?raw';

const ex = exampleProjects.find((e) => e.id === 'lora-two-node-messenger')!;

function boardPins(): Set<string> {
  const el = document.createElement('velxio-esp32') as HTMLElement & { pinInfo?: Array<{ name: string }> };
  el.setAttribute('board-kind', 'esp32-c3');
  document.body.appendChild(el);
  const pins = new Set((el.pinInfo ?? []).map((p) => p.name));
  el.remove();
  return pins;
}

describe('lora-two-node-messenger', () => {
  it('is registered in the gallery with two C3 boards', () => {
    expect(ex).toBeTruthy();
    expect((ex as { boards?: unknown[] }).boards).toHaveLength(2);
  });

  it('every wire endpoint is a real component and a real pin', () => {
    const board = boardPins();
    const chipPins = new Set<string>(JSON.parse(sx1262J).pins);
    const oledPins = new Set(['GND', 'VCC', 'SCL', 'SDA']);
    const buttonPins = new Set(['1.l', '2.l']);
    const boardIds = new Set(['esp32-c3', 'esp32-c3-2']);
    const byId = new Map(ex.components.map((c) => [c.id, c.type]));
    const bad: string[] = [];
    for (const w of ex.wires) {
      for (const e of [w.start, w.end]) {
        const t = boardIds.has(e.componentId) ? 'board' : byId.get(e.componentId);
        const ok =
          t === 'board' ? board.has(e.pinName)
          : t === 'custom-chip' ? chipPins.has(e.pinName)
          : t === 'velxio-ssd1306-i2c-4pin' ? oledPins.has(e.pinName)
          : t === 'wokwi-pushbutton' ? buttonPins.has(e.pinName)
          : false;
        if (!ok) bad.push(`${w.id}: ${e.componentId}.${e.pinName}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('wire and component ids are unique', () => {
    const ids = ex.wires.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cids = ex.components.map((c) => c.id);
    expect(new Set(cids).size).toBe(cids.length);
  });

  it('the two radios share exactly one ANT net', () => {
    const ant = ex.wires.filter((w) => w.start.pinName === 'ANT' || w.end.pinName === 'ANT');
    expect(ant).toHaveLength(1);
  });

  it('no GPIO is used twice on a node', () => {
    for (const n of ['a-', 'b-']) {
      const gpios = ex.wires
        .filter((w) => w.id.startsWith(n))
        .flatMap((w) => [w.start, w.end])
        .filter((e) => /^esp32-c3(-2)?$/.test(e.componentId) && /^\d+$/.test(e.pinName))
        .map((e) => e.pinName);
      expect(new Set(gpios).size).toBe(gpios.length);
    }
  });
});
