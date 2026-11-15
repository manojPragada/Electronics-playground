import { afterEach, expect, it, vi } from 'vitest';
import { PartSimulationRegistry } from '../simulation/parts/PartSimulationRegistry';
import '../simulation/parts/ComplexParts';
import {
  getBoardSimulator,
  getEsp32Bridge,
  useSimulatorStore,
} from '../store/useSimulatorStore';

const frequencies: number[] = [];

class AudioContextMock {
  state = 'running';
  destination = {};
  currentTime = 0;
  resume() {}
  close() {}
  createOscillator() {
    const oscillator = {
      type: '',
      frequency: { value: 440 },
      connect() {},
      disconnect() {},
      start() { frequencies.push(oscillator.frequency.value); },
      stop() {},
      onended: null,
    };
    return oscillator;
  }
  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      },
      connect() {},
      disconnect() {},
    };
  }
}

afterEach(() => {
  useSimulatorStore.getState().removeBoard('buzzer-frequency-test');
  vi.unstubAllGlobals();
  frequencies.length = 0;
});

it('routes QEMU LEDC frequency through the ESP32 store to browser audio', () => {
  vi.stubGlobal('AudioContext', AudioContextMock);
  useSimulatorStore.getState().addBoard('esp32', 0, 0, 'buzzer-frequency-test');
  const simulator = getBoardSimulator('buzzer-frequency-test');
  const bridge = getEsp32Bridge('buzzer-frequency-test');
  expect(simulator).toBeDefined();
  expect(bridge).toBeDefined();

  const cleanup = PartSimulationRegistry.get('buzzer')!.attachEvents!(
    { playing: false } as HTMLElement,
    simulator!,
    (pinName) => pinName === '1' ? 33 : null,
  );
  try {
    // Deliberately omit gpio_routing: the worker now includes the pad on the
    // duty event, so a late routing notification cannot strand the buzzer.
    bridge!.onLedcDuty!({ channel: 0, duty_pct: 49.95, freq_hz: 200, gpios: [33] });
    bridge!.onLedcDuty!({ channel: 0, duty_pct: 0, freq_hz: 200, gpios: [33] });
    bridge!.onLedcDuty!({ channel: 0, duty_pct: 49.95, freq_hz: 4000, gpios: [33] });

    expect(frequencies).toEqual([200, 4000]);
  } finally {
    cleanup();
  }
});
