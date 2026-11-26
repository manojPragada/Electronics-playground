/**
 * LoRa examples: two ESP32-C3 nodes talking over a simulated SX1262 radio.
 *
 * Each node is an ESP32-C3 + SX1262 LoRa chip (the gallery's SX1262 model) +
 * 0.96" SSD1306 OLED (I2C) + two pushbuttons. The two chips' synthetic ANT pins
 * are wired together, which is what stands in for the air: a frame sent by one
 * radio is decoded by the other (see docs/wiki/custom-chips-chip-nets.md).
 *
 * Pin plan (same on both nodes, ESP32-C3 GPIO numbers):
 *   SPI   SCK 4 | MISO 5 | MOSI 6 | NSS 7
 *   Radio RESET 3 | BUSY 10 | DIO1 1
 *   OLED  SDA 8 | SCL 9
 *   Keys  SELECT 0 | SEND 2   (both to GND, INPUT_PULLUP)
 *
 * Honest limits of the simulation: the SX1262 model implements the command
 * sequencing, buffers and IRQs a real driver needs plus a shared medium. It
 * does not model spreading factor, airtime, sensitivity or link budget, so
 * range and RSSI behaviour here say nothing about the real radios.
 */

import type { ExampleProject } from './examples';
import sx1262C from '../components/customChips/examples/sx1262.c?raw';
import sx1262J from '../components/customChips/examples/sx1262.chip.json?raw';

const NODE_SKETCH = (nodeName: string) => `// ${nodeName}: LoRa message node (ESP32-C3 + SX1262 + SSD1306 + 2 buttons)
//
// SELECT (GPIO0) cycles through the predefined messages.
// SEND   (GPIO2) transmits the selected message.
// Anything received is shown on the OLED and the Serial Monitor.
//
// Same sketch runs on both nodes; only NODE_NAME differs.
#include <Wire.h>
#include <SPI.h>
#include <RadioLib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define NODE_NAME "${nodeName}"

// SPI + radio pins
#define PIN_SCK   4
#define PIN_MISO  5
#define PIN_MOSI  6
#define PIN_NSS   7
#define PIN_RESET 3
#define PIN_BUSY  10
#define PIN_DIO1  1
// OLED (I2C)
#define PIN_SDA   8
#define PIN_SCL   9
// Buttons
#define PIN_SELECT 0
#define PIN_SEND   2

const char* MESSAGES[] = {
  "HELLO",
  "OK",
  "NEED HELP",
  "ON MY WAY",
  "AT CAMP",
};
const int N_MESSAGES = sizeof(MESSAGES) / sizeof(MESSAGES[0]);

SX1262 radio = new Module(PIN_NSS, PIN_DIO1, PIN_RESET, PIN_BUSY);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

volatile bool packetArrived = false;
void onDio1() { packetArrived = true; }

int selected = 0;
String lastRx = "(nothing yet)";
String status = "ready";

void draw() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print(NODE_NAME);
  display.print("  ");
  display.print(status);
  display.setCursor(0, 16);
  display.print("TX> ");
  display.print(MESSAGES[selected]);
  display.setCursor(0, 36);
  display.print("RX< ");
  display.print(lastRx);
  display.display();
}

void startListening() {
  radio.setDio1Action(onDio1);
  radio.startReceive();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SELECT, INPUT_PULLUP);
  pinMode(PIN_SEND, INPUT_PULLUP);

  Wire.begin(PIN_SDA, PIN_SCL);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_NSS);
  int state = radio.begin(868.0);
  if (state != RADIOLIB_ERR_NONE) {
    status = "radio err " + String(state);
    Serial.println(status);
  } else {
    Serial.println("SX1262 init ok");
    startListening();
  }
  draw();
}

void loop() {
  if (packetArrived) {
    packetArrived = false;
    String s;
    int state = radio.readData(s);
    if (state == RADIOLIB_ERR_NONE) {
      lastRx = s;
      status = "got msg";
      Serial.print("RX: ");
      Serial.println(s);
    } else {
      status = "rx err " + String(state);
    }
    startListening();
    draw();
  }

  if (digitalRead(PIN_SELECT) == LOW) {
    selected = (selected + 1) % N_MESSAGES;
    status = "selected";
    draw();
    delay(250);  // crude debounce
  }

  if (digitalRead(PIN_SEND) == LOW) {
    status = "sending";
    draw();
    int state = radio.transmit(MESSAGES[selected]);
    status = (state == RADIOLIB_ERR_NONE) ? "sent" : "tx err " + String(state);
    Serial.println(status);
    startListening();
    draw();
    delay(250);
  }
}
`;

type Part = ExampleProject['components'][number];
type Wire = ExampleProject['wires'][number];

/** Everything that hangs off one node's board, ids prefixed by node letter. */
function nodeParts(n: 'a' | 'b', board: string, x: number, y: number): { components: Part[]; wires: Wire[] } {
  const id = (s: string) => `${n}-${s}`;
  const w = (name: string, aC: string, aP: string, bC: string, bP: string, color: string): Wire => ({
    id: id(`w-${name}`),
    start: { componentId: aC, pinName: aP },
    end: { componentId: bC, pinName: bP },
    color,
  });
  const chip = id('sx1262');
  const oled = id('oled');
  const sel = id('btn-select');
  const send = id('btn-send');

  const components: Part[] = [
    {
      type: 'custom-chip',
      id: chip,
      x: x + 420,
      y: y + 20,
      properties: { chipName: `SX1262 LoRa (${n.toUpperCase()})`, sourceC: sx1262C, chipJson: sx1262J, wasmBase64: '' },
    },
    { type: 'velxio-ssd1306-i2c-4pin', id: oled, x: x + 420, y: y + 330, properties: {} },
    { type: 'wokwi-pushbutton', id: sel, x: x + 160, y: y + 400, properties: { color: 'blue' } },
    { type: 'wokwi-pushbutton', id: send, x: x + 260, y: y + 400, properties: { color: 'green' } },
  ];

  const wires: Wire[] = [
    // radio power
    w('chip-vcc', chip, 'VCC', board, '3V3.1', '#ff0000'),
    w('chip-gnd', chip, 'GND', board, 'GND.1', '#000000'),
    // radio SPI + control
    w('sck', board, '4', chip, 'SCK', '#ff9800'),
    w('miso', board, '5', chip, 'MISO', '#9c27b0'),
    w('mosi', board, '6', chip, 'MOSI', '#2196f3'),
    w('nss', board, '7', chip, 'NSS', '#4caf50'),
    w('reset', board, '3', chip, 'RESET', '#795548'),
    w('busy', board, '10', chip, 'BUSY', '#009688'),
    w('dio1', board, '1', chip, 'DIO1', '#e91e63'),
    // OLED
    w('oled-vcc', oled, 'VCC', board, '3V3.2', '#ff0000'),
    w('oled-gnd', oled, 'GND', board, 'GND.2', '#000000'),
    w('oled-sda', board, '8', oled, 'SDA', '#2196f3'),
    w('oled-scl', board, '9', oled, 'SCL', '#ff9800'),
    // buttons: one leg to the GPIO, the other to GND
    w('sel-sig', board, '0', sel, '1.l', '#4caf50'),
    w('sel-gnd', sel, '2.l', board, 'GND.3', '#000000'),
    w('send-sig', board, '2', send, '1.l', '#4caf50'),
    w('send-gnd', send, '2.l', board, 'GND.4', '#000000'),
  ];
  return { components, wires };
}

const nodeA = nodeParts('a', 'esp32-c3', 0, 0);
const nodeB = nodeParts('b', 'esp32-c3-2', 900, 0);

export const loraExamples: ExampleProject[] = [
  {
    id: 'lora-two-node-messenger',
    title: 'LoRa: two-node message sender (ESP32-C3 + SX1262 + OLED)',
    description:
      'Two ESP32-C3 nodes, each with an SX1262 LoRa radio, a 128x64 OLED and two buttons. SELECT cycles through predefined messages, SEND transmits, and the other node shows what arrived. The radios are linked through their ANT pins, which stands in for the air. Models command flow only, not range or modulation.',
    category: 'communication',
    difficulty: 'advanced',
    libraries: ['RadioLib', 'Adafruit SSD1306', 'Adafruit GFX Library'],
    tags: ['lora', 'sx1262', 'esp32-c3', 'ssd1306', 'radio', 'two boards', 'off-grid'],
    boardFilter: 'esp32-c3',
    boards: [
      { boardKind: 'esp32-c3', x: 60, y: 60, code: NODE_SKETCH('Node A') },
      { boardKind: 'esp32-c3', x: 960, y: 60, code: NODE_SKETCH('Node B') },
    ],
    components: [...nodeA.components, ...nodeB.components],
    wires: [
      ...nodeA.wires,
      ...nodeB.wires,
      // the "air": ANT of one radio to ANT of the other
      {
        id: 'air-ant',
        start: { componentId: 'a-sx1262', pinName: 'ANT' },
        end: { componentId: 'b-sx1262', pinName: 'ANT' },
        color: '#ffeb3b',
      },
    ],
  },
];
