// @vitest-environment jsdom
/**
 * Runtime part library: parts defined outside the app (MCP define_part, or
 * shipped in /parts/index.json) become picker entries without a rebuild.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import shipped from '../../public/parts/index.json';
import metadata from '../../public/components-metadata.json';
import registry from '../services/ComponentRegistry';
import { chipPresetComponents } from '../services/chipPresetComponents';
import {
  fitFace,
  partToMetadata,
  refreshPartLibrary,
  resetPartLibraryForTest,
  type PartDef,
} from '../services/partLibrary';
import '../velxio-elements/custom-chip-element';
import type { ComponentMetadata } from '../types/component-metadata';

const e22 = (shipped as { parts: PartDef[] }).parts.find((p) => p.id === 'e22-lora-module')!;
const ids = (q: string) => registry.search(q).map((c) => c.id);

beforeAll(async () => {
  await registry.load().catch(() => undefined);
  registry.mergeComponents((metadata as { components: ComponentMetadata[] }).components);
  registry.mergeComponents(chipPresetComponents());
});

describe('the shipped E22 LoRa module', () => {
  it('matches the pinout printed on the socket, plus the antenna', () => {
    expect(e22.pins.map((p) => p.name)).toEqual([
      'GND', 'VCC', 'NRST', 'NSS', 'SCK', 'MOSI', 'MISO', 'DIO1', 'BUSY', 'DIO2', 'TXEN', 'RXEN', 'ANT',
    ]);
  });

  it('every pin lies inside the body and none overlap', () => {
    const { width, height } = e22.body!;
    const seen = new Set<string>();
    for (const p of e22.pins) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(height);
      const k = `${p.x},${p.y}`;
      expect(seen.has(k), k).toBe(false);
      seen.add(k);
    }
  });

  it('its model registers every pad the part draws, under the same names', () => {
    const src = e22.source_c!;
    for (const name of ['SCK', 'MOSI', 'MISO', 'NSS', 'BUSY', 'DIO1', 'NRST', 'ANT', 'DIO2', 'TXEN', 'RXEN']) {
      expect(src, name).toContain(`vx_pin_register("${name}"`);
    }
    expect(src).not.toContain('vx_pin_register("RESET"');
  });

  it('is offered by the picker for lora, e22 and radio searches', () => {
    registry.mergeComponents([partToMetadata(e22)]);
    expect(ids('lora')).toContain('e22-lora-module');
    expect(ids('e22')[0]).toBe('e22-lora-module');
    expect(ids('radio')).toContain('e22-lora-module');
  });
});

describe('partToMetadata', () => {
  it('builds a pre-filled custom chip with explicit pins and an exact body', () => {
    const m = partToMetadata(e22);
    expect(m.chipPreset).toBe(true);
    expect(m.tagName).toBe('velxio-custom-chip');
    expect(m.category).toBe('communication');
    expect(m.pinCount).toBe(13);
    const cj = JSON.parse(m.defaultValues.chipJson);
    expect(cj.body).toEqual(e22.body);
    expect(cj.pins[0]).toEqual({ name: 'GND', x: 22, y: 26 });
    expect(m.defaultValues.image).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(m.defaultValues.sourceC).toContain('NRST');
    expect(m.defaultValues.wasmBase64).toBe('');
  });

  it('an unknown category falls back to other; a part with no pins is refused', () => {
    expect(partToMetadata({ ...e22, category: 'weird' }).category).toBe('other');
    expect(() => partToMetadata({ ...e22, pins: [] })).toThrow();
  });

  it('a part without a face still gets a thumbnail and no image', () => {
    const m = partToMetadata({ id: 'plain-part', name: 'Plain', category: 'other', pins: [{ name: 'A', x: 5, y: 5 }] });
    expect(m.thumbnail).toContain('<svg');
    expect(m.defaultValues.image).toBe('');
  });
});

describe('fitFace', () => {
  it('forces the face onto the body box and keeps a viewBox', () => {
    const out = fitFace('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 50 50"><rect/></svg>', 120, 236);
    expect(out).toContain('width="120"');
    expect(out).toContain('height="236"');
    expect(out).toContain('viewBox="0 0 50 50"');
    expect(out.match(/width=/g)).toHaveLength(1);
  });
  it('adds a body-sized viewBox when the face has none', () => {
    expect(fitFace('<svg><rect/></svg>', 100, 80)).toContain('viewBox="0 0 100 80"');
  });
});

describe('the chip element honours an exact body', () => {
  it('sizes to the body and places pins where the part says', () => {
    const el = document.createElement('velxio-custom-chip') as HTMLElement & {
      pinInfo: Array<{ name: string; x: number; y: number }>;
    };
    const m = partToMetadata(e22);
    (el as unknown as { chipName: string }).chipName = e22.name;
    (el as unknown as { chipJson: string }).chipJson = m.defaultValues.chipJson;
    document.body.appendChild(el);
    expect(el.style.width).toBe(`${e22.body!.width}px`);
    expect(el.style.height).toBe(`${e22.body!.height}px`);
    const byName = Object.fromEntries(el.pinInfo.map((p) => [p.name, p]));
    expect(byName.ANT).toMatchObject({ x: 60, y: 222 });
    expect(byName.TXEN).toMatchObject({ x: 22, y: 126 });
    el.remove();
  });
});

describe('refreshPartLibrary', () => {
  const part = (id: string, name = id): PartDef => ({
    id, name, category: 'sensors', pins: [{ name: 'A', x: 10, y: 10 }], tags: ['zzqq'],
  });
  const respond = (staticParts: PartDef[], live: PartDef[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parts = url.includes('/api/parts') ? live : url.includes('parts/index.json') ? staticParts : [];
        return { ok: true, json: async () => ({ parts }) } as Response;
      }),
    );

  beforeEach(() => resetPartLibraryForTest());
  afterEach(() => vi.unstubAllGlobals());

  it('adds live parts, lets them replace shipped ones, and drops ones that disappear', async () => {
    respond([part('shipped-a', 'Shipped A')], [part('live-b'), part('shipped-a', 'Live A')]);
    expect(await refreshPartLibrary()).toBe(2);
    expect(registry.getById('live-b')).toBeTruthy();
    expect(registry.getById('shipped-a')!.name).toBe('Live A');
    expect(ids('zzqq')).toEqual(expect.arrayContaining(['live-b', 'shipped-a']));

    respond([part('shipped-a', 'Shipped A')], []);
    expect(await refreshPartLibrary()).toBe(1);
    expect(registry.getById('live-b')).toBeUndefined();
    expect(registry.getById('shipped-a')!.name).toBe('Shipped A');
  });

  it('does nothing, and does not re-render the picker, when nothing changed', async () => {
    respond([part('steady-part')], []);
    await refreshPartLibrary();
    const v = registry.getVersion();
    await refreshPartLibrary();
    expect(registry.getVersion()).toBe(v);
  });

  it('never replaces a component the app ships', async () => {
    const before = registry.getById('led')!;
    respond([], [{ ...part('led', 'Hijack') }]);
    await refreshPartLibrary();
    expect(registry.getById('led')).toBe(before);
  });

  it('survives a host with no endpoint and a malformed part', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await refreshPartLibrary()).toBe(0);
    respond([{ id: 'broken-part', name: 'Broken', category: 'other', pins: [] } as PartDef, part('fine-part')], []);
    expect(await refreshPartLibrary()).toBe(1);
    expect(registry.getById('fine-part')).toBeTruthy();
    expect(registry.getById('broken-part')).toBeUndefined();
  });
});
