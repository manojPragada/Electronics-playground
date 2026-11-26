/**
 * Runtime part library (frontend half).
 *
 * Parts are defined outside the app: by the MCP server's `define_part` tool
 * (served by GET /api/parts/) or shipped as data in /parts/index.json. Each is
 * turned into a picker entry and merged into the ComponentRegistry while the
 * app is running, so a new module appears in Add Component without a rebuild.
 *
 * Under the hood a part is a normal custom chip: explicit pin positions
 * (chip.json), a face image, optional C source. Dropping one puts a
 * `custom-chip` component on the canvas pre-filled from `defaultValues`
 * (see SimulatorCanvas.handleSelectComponent, `chipPreset`).
 */
import registry from './ComponentRegistry';
import type { ComponentCategory, ComponentMetadata } from '../types/component-metadata';

export interface PartPin {
  name: string;
  x: number;
  y: number;
}

export interface PartDef {
  id: string;
  name: string;
  description?: string;
  category: string;
  tags?: string[];
  keywords?: string[];
  pins: PartPin[];
  body?: { width: number; height: number };
  face_svg?: string;
  source_c?: string;
}

const CATEGORIES: ReadonlySet<string> = new Set<ComponentCategory>([
  'boards', 'sensors', 'displays', 'input', 'output', 'motors', 'communication',
  'connectivity', 'passive', 'logic', 'analog', 'electromech', 'other',
]);

/** Make a face SVG fill exactly the body box (0,0 .. width,height). */
export function fitFace(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    const hasViewBox = /\sviewBox\s*=/i.test(attrs);
    const cleaned = attrs
      .replace(/\s(?:x|y|width|height|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, '')
      .replace(/\sxmlns\s*=\s*("[^"]*"|'[^']*')/i, '');
    return (
      `<svg xmlns="http://www.w3.org/2000/svg"${cleaned} x="0" y="0" width="${width}" height="${height}"` +
      `${hasViewBox ? '' : ` viewBox="0 0 ${width} ${height}"`} preserveAspectRatio="none">`
    );
  });
}

function faceDataUrl(def: PartDef): string {
  if (!def.face_svg || !def.body) return '';
  const { width: w, height: h } = def.body;
  // The chip element draws the image inset by (8, 4) and scales it to
  // (w - 16, h - 8) with "meet": a viewBox of exactly that inner box, holding
  // the face at body coordinates, makes the artwork land 1:1 under the pins.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 4 ${w - 16} ${h - 8}" width="${w - 16}" height="${h - 8}">` +
    `${fitFace(def.face_svg, w, h)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function thumbnail(def: PartDef): string {
  if (def.face_svg && def.body) {
    const { width: w, height: h } = def.body;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${fitFace(def.face_svg, w, h)}</svg>`;
  }
  return (
    '<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="8" y="12" width="48" height="40" rx="3" fill="#1a1a1a" stroke="#888" stroke-width="2"/>' +
    '<rect x="3" y="20" width="6" height="3" fill="#c0c0c0"/><rect x="3" y="32" width="6" height="3" fill="#c0c0c0"/><rect x="3" y="44" width="6" height="3" fill="#c0c0c0"/>' +
    '<rect x="55" y="20" width="6" height="3" fill="#c0c0c0"/><rect x="55" y="32" width="6" height="3" fill="#c0c0c0"/><rect x="55" y="44" width="6" height="3" fill="#c0c0c0"/>' +
    '</svg>'
  );
}

/** Picker entry for a part. Throws if the definition is unusable. */
export function partToMetadata(def: PartDef): ComponentMetadata {
  if (!def || typeof def.id !== 'string' || typeof def.name !== 'string' || !Array.isArray(def.pins) || def.pins.length === 0) {
    throw new Error('part needs id, name and pins');
  }
  const category = (CATEGORIES.has(def.category) ? def.category : 'other') as ComponentCategory;
  const chipJson = JSON.stringify({
    name: def.name,
    pins: def.pins.map((p) => ({ name: p.name, x: p.x, y: p.y })),
    ...(def.body ? { body: def.body } : {}),
  });
  return {
    id: def.id,
    tagName: 'velxio-custom-chip',
    name: def.name,
    category,
    description: def.description ?? '',
    thumbnail: thumbnail(def),
    properties: [],
    defaultValues: {
      chipName: def.name,
      sourceC: def.source_c ?? '',
      chipJson,
      wasmBase64: '',
      romBytes: '',
      programFile: '',
      programTarget: '',
      image: faceDataUrl(def),
    },
    pinCount: def.pins.length,
    tags: [...(def.tags ?? []), 'part'],
    keywords: def.keywords ?? [],
    chipPreset: true,
  };
}

async function getParts(url: string): Promise<PartDef[]> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { parts?: PartDef[] };
    return Array.isArray(body.parts) ? body.parts : [];
  } catch {
    return []; // no server, offline, or a host without the endpoint: just no parts from here
  }
}

/** Shipped parts first, then the live library; a live part replaces a shipped one with the same id. */
export async function loadPartDefs(): Promise<PartDef[]> {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const [shipped, live] = await Promise.all([getParts(`${base}parts/index.json`), getParts('/api/parts/')]);
  const byId = new Map<string, PartDef>();
  for (const d of [...shipped, ...live]) if (d && typeof d.id === 'string') byId.set(d.id, d);
  return [...byId.values()];
}

let mergedIds = new Set<string>();
let lastSignature = '';

/**
 * Bring the registry in line with the library. Cheap to call often: nothing is
 * merged (and no picker re-renders) unless the definitions changed.
 * Returns the number of parts now offered.
 */
export async function refreshPartLibrary(): Promise<number> {
  const defs = await loadPartDefs();
  const signature = JSON.stringify(defs);
  if (signature === lastSignature) return mergedIds.size;
  lastSignature = signature;

  const metas: ComponentMetadata[] = [];
  for (const def of defs) {
    // A part never replaces something the app ships under the same id.
    const existing = registry.getById(def.id);
    if (existing && !mergedIds.has(def.id)) continue;
    try {
      metas.push(partToMetadata(def));
    } catch {
      /* skip a malformed part; the rest still load */
    }
  }
  const next = new Set(metas.map((m) => m.id));
  const gone = [...mergedIds].filter((id) => !next.has(id));
  if (gone.length) registry.removeComponents(gone);
  if (metas.length) registry.mergeComponents(metas);
  mergedIds = next;
  return next.size;
}

let started = false;

/** Load the library now and again whenever the tab regains focus. Browser only. */
export function startPartLibrary(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  void refreshPartLibrary();
  window.addEventListener('focus', () => void refreshPartLibrary());
}

/** Test seam. */
export function resetPartLibraryForTest(): void {
  mergedIds = new Set();
  lastSignature = '';
  started = false;
}
