/**
 * Ready-made chips offered in the Add Component picker.
 *
 * The gallery's chip models (SX1262 LoRa, ...) used to be reachable only from
 * the Custom Chip dialog, so searching the picker for "lora" found nothing.
 * Each entry here is a picker card that, when chosen, drops a normal
 * `custom-chip` component pre-filled with the model's C source and pin list
 * (see SimulatorCanvas.handleSelectComponent). Nothing new is simulated: Run
 * compiles the source like any custom chip.
 */
import { findExample } from '../components/customChips/chipExamples';
import type { ComponentMetadata } from '../types/component-metadata';

/** Same defaults the generic Custom Chip entry carries, so a dropped preset
 *  has every property the custom-chip pipeline reads. */
const EMPTY_CHIP_DEFAULTS = {
  wasmBase64: '',
  romBytes: '',
  programFile: '',
  programTarget: '',
  image: '',
};

interface Preset {
  /** id of the ChipExample in chipExamples.ts */
  exampleId: string;
  /** picker id */
  id: string;
  name: string;
  description: string;
  tags: string[];
  keywords: string[];
  /** two-line label drawn on the thumbnail */
  label: [string, string];
  accent: string;
}

const PRESETS: Preset[] = [
  {
    exampleId: 'sx1262',
    id: 'chip-sx1262',
    name: 'SX1262 LoRa Module',
    description:
      'Semtech SX1262 LoRa transceiver over SPI (SCK/MOSI/MISO/NSS, BUSY, DIO1, RESET) with an ANT pin: wire the ANT pins of two modules together and frames cross between them. Works with RadioLib. Models command flow only, not range or modulation.',
    tags: ['lora', 'sx1262', 'radio', 'transceiver', 'wireless', 'spi', 'chip'],
    keywords: [
      'lora radio transceiver wireless long range off grid mesh meshtastic',
      'semtech sx126x sx1261 868 915 433 mhz spi radiolib',
      'ebyte e22 waveshare core1262 ai-thinker ra-01sc',
    ],
    label: ['LoRa', 'SX1262'],
    accent: '#1565c0',
  },
];

function thumbnail(p: Preset): string {
  return (
    '<svg width="64" height="64" xmlns="http://www.w3.org/2000/svg">' +
    `<rect x="6" y="14" width="52" height="36" rx="3" fill="#1a1a1a" stroke="${p.accent}" stroke-width="2"/>` +
    '<rect x="2" y="20" width="6" height="3" fill="#c0c0c0"/><rect x="2" y="30" width="6" height="3" fill="#c0c0c0"/><rect x="2" y="40" width="6" height="3" fill="#c0c0c0"/>' +
    '<rect x="56" y="20" width="6" height="3" fill="#c0c0c0"/><rect x="56" y="30" width="6" height="3" fill="#c0c0c0"/><rect x="56" y="40" width="6" height="3" fill="#c0c0c0"/>' +
    `<text x="32" y="30" text-anchor="middle" font-family="monospace" font-size="9" font-weight="bold" fill="#e0e0e0">${p.label[0]}</text>` +
    `<text x="32" y="42" text-anchor="middle" font-family="monospace" font-size="7" fill="${p.accent}">${p.label[1]}</text>` +
    '</svg>'
  );
}

/** Picker entries for the presets whose chip example is present. */
export function chipPresetComponents(): ComponentMetadata[] {
  const out: ComponentMetadata[] = [];
  for (const p of PRESETS) {
    const ex = findExample(p.exampleId);
    if (!ex) continue;
    let pinCount = 0;
    try {
      pinCount = (JSON.parse(ex.chipJson).pins as unknown[]).length;
    } catch {
      /* leave 0: the chip designer reads the JSON itself */
    }
    out.push({
      id: p.id,
      tagName: 'velxio-custom-chip',
      name: p.name,
      category: 'communication',
      description: p.description,
      thumbnail: thumbnail(p),
      properties: [],
      defaultValues: {
        chipName: p.name,
        sourceC: ex.sourceC,
        chipJson: ex.chipJson,
        ...EMPTY_CHIP_DEFAULTS,
      },
      pinCount,
      tags: p.tags,
      keywords: p.keywords,
      chipPreset: true,
    });
  }
  return out;
}
