/**
 * Ready-made chips are findable in the Add Component picker.
 * Regression: searching "lora" returned "No components found" because the
 * SX1262 model lived only in the Custom Chip dialog.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import metadata from '../../public/components-metadata.json';
import registry from '../services/ComponentRegistry';
import { chipPresetComponents } from '../services/chipPresetComponents';
import type { ComponentMetadata } from '../types/component-metadata';

beforeAll(async () => {
  await registry.load().catch(() => undefined);
  registry.mergeComponents((metadata as { components: ComponentMetadata[] }).components);
  // load() adds these in the browser; no server here, so merge them directly.
  registry.mergeComponents(chipPresetComponents());
});

const ids = (q: string) => registry.search(q).map((c) => c.id);

describe('chip presets in the picker', () => {
  it('"lora" finds the SX1262 module first', () => {
    expect(ids('lora')[0]).toBe('chip-sx1262');
  });

  it('finds it by chip name, radio and module names', () => {
    for (const q of ['sx1262', 'radio', 'transceiver', 'e22', 'meshtastic']) {
      expect(ids(q), q).toContain('chip-sx1262');
    }
  });

  it('is a communication part carrying the full chip source and pins', () => {
    const c = registry.getById('chip-sx1262')!;
    expect(c.category).toBe('communication');
    expect(c.chipPreset).toBe(true);
    expect(c.custom).toBeFalsy();
    expect(c.tagName).toBe('velxio-custom-chip');
    expect(c.defaultValues.sourceC).toContain('SX1262');
    expect(c.defaultValues.wasmBase64).toBe('');
    const pins = JSON.parse(c.defaultValues.chipJson).pins as string[];
    expect(pins).toEqual(expect.arrayContaining(['SCK', 'MOSI', 'MISO', 'NSS', 'BUSY', 'DIO1', 'RESET', 'ANT']));
    expect(c.pinCount).toBe(pins.length);
  });

  it('carries every default the generic Custom Chip entry has', () => {
    const preset = chipPresetComponents()[0];
    for (const k of ['chipName', 'sourceC', 'chipJson', 'wasmBase64', 'romBytes', 'programFile', 'programTarget', 'image']) {
      expect(preset.defaultValues, k).toHaveProperty(k);
    }
  });
});
