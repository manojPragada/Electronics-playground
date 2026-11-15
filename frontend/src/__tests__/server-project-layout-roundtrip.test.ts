// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { useSimulatorStore } from '../store/useSimulatorStore';
import { useEditorStore } from '../store/useEditorStore';
import { useCanvasViewportStore } from '../store/useCanvasViewportStore';
import { buildVlxPayload, importVlxFile } from '../utils/vlxFile';

describe('saved project visual layout', () => {
  it('restores moved parts, separate ESP32 GND pads, wire bends, stacking, and camera', async () => {
    const board = { id: 'esp32', boardKind: 'esp32', x: 37, y: 91,
      activeFileGroupId: 'group-esp32', languageMode: 'arduino' };
    const components = [
      { id: 'led', metadataId: 'led', x: 530, y: 320, properties: { color: 'red' } },
      { id: 'lcd', metadataId: 'lcd1602-i2c', x: 470, y: -85, properties: {} },
    ];
    const wires = [
      { id: 'left-ground', start: { componentId: 'led', pinName: 'C', x: 550, y: 340 },
        end: { componentId: 'esp32', pinName: 'GND', x: 43, y: 285 },
        waypoints: [{ x: 400, y: 410 }], color: '#000000', autoRouted: false },
      { id: 'right-ground', start: { componentId: 'lcd', pinName: 'GND', x: 480, y: -40 },
        end: { componentId: 'esp32', pinName: 'GND2', x: 171, y: 285 },
        waypoints: [{ x: 260, y: -20 }, { x: 260, y: 285 }], color: '#000000', autoRouted: false },
    ];
    useSimulatorStore.setState({ boards: [board], activeBoardId: 'esp32',
      components, wires, zOrders: { esp32: 1, led: 3, lcd: 2 }, zTop: 3 } as never);
    useEditorStore.getState().createFileGroup('group-esp32', [
      { name: 'sketch.ino', content: 'void setup() {}' },
    ]);
    useCanvasViewportStore.getState().restore({ pan: { x: -180, y: 65 }, zoom: 1.35 });

    const saved = buildVlxPayload({ name: 'layout' });
    expect(saved.wires.map((w) => w.end.pinName)).toEqual(['GND', 'GND2']);
    expect(saved.viewport).toEqual({ pan: { x: -180, y: 65 }, zoom: 1.35 });

    useSimulatorStore.setState({ boards: [], components: [], wires: [], zOrders: {}, zTop: 0 } as never);
    useCanvasViewportStore.getState().restore();
    await importVlxFile(new File([JSON.stringify(saved)], 'layout.vlx', { type: 'application/json' }));

    const loaded = useSimulatorStore.getState();
    expect(loaded.boards[0]).toMatchObject({ id: 'esp32', x: 37, y: 91 });
    expect(loaded.components.map((c) => [c.id, c.x, c.y])).toEqual([
      ['led', 530, 320], ['lcd', 470, -85],
    ]);
    expect(loaded.wires.map((w) => w.end.pinName)).toEqual(['GND', 'GND2']);
    expect(loaded.wires[1].waypoints).toEqual([{ x: 260, y: -20 }, { x: 260, y: 285 }]);
    expect(loaded.zOrders).toEqual({ esp32: 1, led: 3, lcd: 2 });
    expect(useCanvasViewportStore.getState()).toMatchObject({ pan: { x: -180, y: 65 }, zoom: 1.35 });
  });
});
