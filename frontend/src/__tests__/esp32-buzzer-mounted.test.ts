// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DynamicComponent } from '../components/DynamicComponent';
import { getEsp32Bridge, useSimulatorStore } from '../store/useSimulatorStore';

const frequencies: number[] = [];
class AudioContextMock {
  state = 'running';
  destination = {};
  currentTime = 0;
  resume() {}
  close() {}
  createOscillator() {
    const osc = {
      type: '', frequency: { value: 440 }, connect() {}, disconnect() {},
      start() { frequencies.push(osc.frequency.value); }, stop() {}, onended: null,
    };
    return osc;
  }
  createGain() {
    return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect() {}, disconnect() {} };
  }
}

afterEach(() => {
  useSimulatorStore.getState().removeBoard('buzzer-mounted-board');
  frequencies.length = 0;
  vi.unstubAllGlobals();
});

it('the mounted buzzer follows the wired ESP32 GPIO and its changing pitch', async () => {
  vi.stubGlobal('AudioContext', AudioContextMock);
  const store = useSimulatorStore.getState();
  store.addBoard('esp32', 0, 0, 'buzzer-mounted-board');
  store.setActiveBoardId('buzzer-mounted-board');
  store.setComponents([{ id: 'mounted-buzzer', metadataId: 'buzzer', x: 0, y: 0,
    properties: { hasSignal: false } }] as never);
  store.setWires([{ id: 'buzzer-wire', start: { componentId: 'buzzer-mounted-board',
    pinName: '33', x: 0, y: 0 }, end: { componentId: 'mounted-buzzer', pinName: '1',
    x: 0, y: 0 }, waypoints: [] }] as never);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(DynamicComponent, { id: 'mounted-buzzer', metadata: {
        id: 'buzzer', tagName: 'wokwi-buzzer', name: 'Buzzer', category: 'output',
        properties: [], defaultValues: {}, pinCount: 2, tags: [], thumbnail: '',
      } as never, properties: { hasSignal: false } }));
    });
    const bridge = getEsp32Bridge('buzzer-mounted-board')!;
    expect(container.querySelector('[data-testid="buzzer-frequency"]')?.textContent)
      .toContain('waiting');
    await act(async () => {
      bridge.onLedcDuty!({ channel: 0, duty_pct: 50, freq_hz: 200, gpios: [33] });
      bridge.onLedcDuty!({ channel: 0, duty_pct: 50, freq_hz: 200, gpios: [33] });
      bridge.onLedcDuty!({ channel: 0, duty_pct: 0, freq_hz: 200, gpios: [33] });
      bridge.onLedcDuty!({ channel: 0, duty_pct: 50, freq_hz: 4000, gpios: [33] });
    });
    expect(frequencies).toEqual([200, 4000]);
    expect(container.querySelector('wokwi-buzzer')?.getAttribute('title'))
      .toContain('200 → 4000');
    expect(container.querySelector('[data-testid="buzzer-frequency"]')?.textContent)
      .toContain('4000 Hz');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
