'use strict';

/**
 * ===============================================================================
 * TUYA F3 PRO TOUCHPANEL ZIGBEE2MQTT CONVERTER - v41 DASHBOARD EDITION
 * ===============================================================================
 *
 * Model: Tuya F3 PRO Touch Panel (_TZE284_idn2htgu)
 * Firmware baseline: hardware-validated v41
 * Converter revision: 41.3
 *
 * ✅ WHAT WORKS (100% functional):
 * - All 4 relay switches (L1-L4) with LED indicators
 * - All 4 dimmer groups (G1-G4) with brightness and color temperature control
 * - 2 curtain controllers with position and state control
 * - 8 scene buttons with action detection
 * - Backlight control
 * - ALL 20+ text fields for custom naming (L1-L4, G1-G4, scenes, curtains)
 *   * Perfect Z2M entity updates and Home Assistant automation integration
 *   * Two-way synchronization between panel and Z2M
 *   * Multiple field name formats supported (l1_name, switch_1_name, etc.)
 *
 * ⚠️  TEXT FIELD ENCODING - FIXED (confirmed live 2026-09-13):
 * - Previously: UTF-16LE payload -> "rectangles" on the panel's own screen
 *   (Z2M integration itself was always fine either way; this is purely
 *   about what the physical panel renders).
 * - Root cause found by static analysis of the panel's firmware
 *   (leopard.axf, Tuya wired-serial DP dispatcher FUN_e920d8a0) and
 *   confirmed against real hardware: each name-field character must be
 *   sent as its 4-digit hex UTF-16 code unit (e.g. 'T' = U+0054 -> "0054"),
 *   concatenated with no separators. A first attempt at 2-hex-digits-per-
 *   byte was tried live and produced exactly 3/2/2 boxes for
 *   "TestOK"/"12345"/"test" -- exactly floor(hexLength/4) in each case,
 *   because the firmware was grouping that payload into 4-character
 *   chunks and decoding each as a garbage CJK/Hangul-range code point with
 *   no glyph in the panel's font. See encodeNameAsHexCodeUnits()'s comment
 *   below for the full reasoning.
 * - Now sends e.g. "Office" -> "004f00660066006900630065" as the payload.
 *
 * 🔧 CUSTOMIZATION FOR OTHER MANUFACTURERS:
 * Change line 45 fingerprint to match your device:
 * fingerprint: [{modelID: 'TS0601', manufacturerName: '_TZE284_YOUR_MANUFACTURER_ID'}]
 *
 * 📝 DPID MAPPING (verified through extensive testing):
 * - L1-L4 switches: 121-124 (control), 137-140 (names)
 * - G1-G4 dimmers: 102,103,105,107 (brightness), 109-112 (color temp), 125-128 (names)
 * - Curtains: 113-114 (position), 133-134 (state), 129-132 (names)
 * - Scenes: 1-8 (actions), 141-148 (names)
 * - LEDs: 117-120, Backlight: 149
 *
 * 📚 COMMUNITY CONTRIBUTION:
 * This converter represents months of reverse engineering, packet capture analysis,
 * and systematic testing. Feel free to adapt for similar Tuya touchpanels.
 *
 * 🔗 INSTALLATION:
 * 1. Save as external converter in Zigbee2MQTT
 * 2. Add to configuration.yaml external_converters list
 * 3. Restart Zigbee2MQTT
 * 4. Re-interview your touchpanel device
 *
 * ===============================================================================
 */

const exposes = require('zigbee-herdsman-converters/lib/exposes');
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const tuya = require('zigbee-herdsman-converters/lib/tuya');

const e = exposes.presets;
const ea = exposes.access;

// Use Zigbee2MQTT's native F3-Pro weather transport. The panel only exposes
// temperature_1/condition_1 to the user, but its wire protocol uses the full
// current-weather + three-forecast-slot frame. These arguments deliberately
// match the official F3-Pro definition; smaller layouts trigger an allocator
// bug in affected zigbee-herdsman-converters releases.
if (!tuya.modernExtend?.tuyaWeatherForecast || !tuya.F3ProTuyaWeatherCondition) {
  throw new Error(
    'This F3-Pro converter requires zigbee-herdsman-converters 26.5.0 or newer for weather support',
  );
}
const weatherExtension = tuya.modernExtend.tuyaWeatherForecast({
  includeCurrentWeather: true,
  numberOfForecastDays: 3,
  correctForNegativeValues: false,
  weatherConditionMap: tuya.F3ProTuyaWeatherCondition,
});
const F3PRO_WEATHER_CONDITIONS = Object.keys(tuya.F3ProTuyaWeatherCondition);

// Explicitly retain the real F3 day-1 keys for compatibility across helper
// revisions. This is harmless where they are already present because Set
// removes duplicates.
const weatherToZigbee = (weatherExtension.toZigbee || []).map((converter) => {
  if (!Array.isArray(converter.key)) return converter;
  return {
    ...converter,
    key: [...new Set([...converter.key, 'temperature_1', 'condition_1'])],
  };
});

// ===============================================================================
// EMBEDDED SHARED LOGIC (previously external dependencies)
// ===============================================================================

/**
 * 4-hex-digit-per-character encoding for text (name) fields.
 *
 * Reverse-engineered from the panel's own firmware (leopard.axf, the Tuya
 * wired-serial DP dispatcher at FUN_e920d8a0), and CONFIRMED live on
 * hardware on 2026-09-13. The hex-decode loop (LAB_e920e1dc) reads FOUR
 * hex-digit characters per iteration (not two), combines them into a single
 * 16-bit value, and hands that whole 16-bit code UNIT to FUN_e920b8ac (a
 * UTF-8-style encoder writing 1-3 bytes into the name buffer depending on
 * the code unit's range) -- advancing the read cursor by 4 characters each
 * time. So each character must be sent as its 4-digit hex UTF-16 code unit
 * (e.g. 'T' = U+0054 -> "0054"), not 2 hex digits per raw byte.
 *
 * An earlier 2-hex-digit-per-byte attempt was tried live and produced
 * exactly 3/2/2 boxes for "TestOK"/"12345"/"test" respectively -- precisely
 * floor(hexLength/4) for each (12/4=3, 10/4=2 rem 2 discarded, 8/4=2),
 * because the firmware was grouping that payload into 4-character chunks
 * and decoding each as a garbage high-range (mostly CJK/Hangul) code point
 * with no glyph in the panel's font -- a decisive, exact match confirming
 * this 4-per-character scheme instead.
 *
 * e.g. name "Office" -> wire payload is "004f00660066006900630065"
 * (24 ASCII characters: hex(0x004f) + hex(0x0066) + ... one 4-char group
 * per source character).
 */
function encodeNameAsHexCodeUnits(str, maxNameChars = 8) {
  const s = String(str ?? '').slice(0, maxNameChars);
  let hex = '';
  for (let i = 0; i < s.length; i++) {
    hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return Buffer.from(hex, 'ascii');
}

function crc8Atm(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (((crc << 1) ^ 0x07) & 0xff) : ((crc << 1) & 0xff);
    }
  }
  return crc;
}

const PATCHER_TEST_PAYLOAD = Buffer.from(
  '2972bb044d96df2871ba034c95de2770b9024b94dd266fb8014a93dc256eb700' +
  '4992db246db6ff4891da236cb5fe4790d9226bb4fd468fd8216ab3fc458ed720' +
  '69b2fb448dd61f68b1fa438cd51e67b0f9428bd41d66aff8418ad31c65aef74089d21b64' +
  'adf63f88d11a63acf53e87d01962abf43d86cf1861aaf33c85ce1760a9f23b84cd165fa8' +
  'f13a83cc155ea7f03982cb145da6ef3881ca135ca5ee3780c9125ba4ed367fc8115aa3ec3' +
  '57ec71059a2eb347dc60f58a1ea337cc50e57a0e9327bc40d569fe8317ac30c559ee73079' +
  'c20b549de62f78c10a539ce52e77c009529be42d76bf08519ae32c75be075099e22b74bd' +
  '064f98e12a73bc054e97e0',
  'hex',
);
const PATCHER_TEST_SHA256 = Buffer.from(
  '2159f0f09fbc3544fa77af9efcac3f54e6bddb592ba7df6c6047fba1f0f4195a',
  'hex',
);

function makePatcherV33Frame(opcode, offset = 0, payload = Buffer.alloc(0)) {
  if (!['B', 'H', 'D', 'V', 'C', 'S', 'R'].includes(opcode) ||
      offset < 0 || offset > 0xffffff || payload.length > 8) {
    throw new Error('Invalid v33 patcher frame');
  }
  const frame = Buffer.alloc(32, '0');
  frame.write(`F3P3${opcode}`, 0, 'ascii');
  frame.write(offset.toString(16).padStart(6, '0').toUpperCase(), 5, 'ascii');
  frame.write(payload.length.toString(16).toUpperCase(), 11, 'ascii');
  frame.write(payload.toString('hex').toUpperCase(), 12, 'ascii');
  const crc = crc8Atm(frame.subarray(0, 30));
  frame.write(crc.toString(16).padStart(2, '0').toUpperCase(), 30, 'ascii');
  return frame;
}

const patcherDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// The panel's ARM dispatcher accepts DPIDs 125-132 only when the Tuya
// datatype is STRING (3).  Sending the identical bytes as RAW (0) produces a
// Zigbee echo but is deliberately skipped before the UI name table is updated.
// DPIDs 137-148 use a separate firmware branch and retain the proven RAW path.
const STRING_NAME_DPIDS = new Set([125,126,127,128,129,130,131,132]);
async function sendEncodedName(entity, dpId, encoded) {
  if (STRING_NAME_DPIDS.has(dpId)) {
    return tuya.sendDataPointStringBuffer(entity, dpId, encoded.toString('ascii'));
  }
  return tuya.sendDataPointRaw(entity, dpId, encoded);
}

/** Decode text fields from panel responses: reverse of encodeNameAsHexCodeUnits. */
function tuyaRawBytes(payload) {
  if (payload == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload, 'ascii');
  if (Array.isArray(payload) || ArrayBuffer.isView(payload)) return Buffer.from(payload);

  // zigbee-herdsman-converters can serialise a Tuya RAW value into an object
  // such as {"0":48,"1":48,...}. Buffer.from(object) does not reliably
  // recognise that representation because it has no `length` property.
  if (typeof payload === 'object') {
    if (payload.data != null && payload.data !== payload) return tuyaRawBytes(payload.data);
    const numericKeys = Object.keys(payload)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length) {
      return Buffer.from(numericKeys.map((key) => Number(payload[key]) & 0xff));
    }
  }
  return Buffer.alloc(0);
}

function decodeTuyaText(payload) {
  const b = tuyaRawBytes(payload);
  let hex = '';
  for (let i = 0; i < b.length; i++) {
    const c = String.fromCharCode(b[i]);
    if (/^[0-9a-fA-F]$/.test(c)) hex += c;
    else break;
  }
  hex = hex.slice(0, Math.floor(hex.length / 4) * 4); // drop any incomplete trailing group
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out.replace(/ +$/, '');
}

function scaleNumber(v, inMin, inMax, outMin, outMax) {
  return Math.round(((Number(v) - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin);
}

/** Brightness % (1..100) <-> Tuya 1..102 with LED gating */
function dimmerPct(gateKey) {
  return {
    from: (v) => scaleNumber(v, 1, 102, 1, 100),
    to: (v, meta) => {
      const gate = (meta?.state?.[gateKey]) ?? 'ON';
      if (gate !== 'ON') return undefined;
      return scaleNumber(v, 1, 100, 1, 102);
    },
  };
}

/** Color temp % (0..100) passthrough with LED gating */
function dimmerConverter(gateKey) {
  return {
    from: (v) => Number(v),
    to: (v, meta) => {
      const gate = (meta?.state?.[gateKey]) ?? 'ON';
      if (gate !== 'ON') return undefined;
      return Number(v);
    },
  };
}

/** Curtain position scaler with auto 0–100 vs 0–1000 detection */
function makeCurtainScaler() {
  const st = { scale: 100, invert: false };
  return {
    from: (v) => {
      const raw = Number(v);
      st.scale = raw > 100 ? 1000 : 100;
      let pct = st.scale === 1000 ? Math.round(raw / 10) : raw;
      pct = Math.max(0, Math.min(100, pct));
      if (st.invert) pct = 100 - pct;
      return pct;
    },
    to: (v) => {
      let pct = Math.max(0, Math.min(100, Number(v)));
      if (st.invert) pct = 100 - pct;
      return st.scale === 1000 ? pct * 10 : pct;
    },
    st,
  };
}

/** LED anti-fight lock (per device, per index) */
const LOCK_MS = 1200;
const ledLock = new WeakMap();
function _getLock(dev) {
  let s = ledLock.get(dev);
  if (!s) { s = { desired: {}, until: {} }; ledLock.set(dev, s); }
  return s;
}
function lockLed(dev, idx, val) {
  const s = _getLock(dev);
  s.desired[idx] = val;
  s.until[idx] = Date.now() + LOCK_MS;
}
function isLockedAgainst(dev, idx, incomingVal) {
  const s = _getLock(dev);
  const until = s.until[idx] || 0;
  if (Date.now() > until) return false;
  const desired = s.desired[idx];
  return desired && desired !== incomingVal;
}

/** Recent-write squelch */
const WRITE_SQUELCH_MS = 2500;
const recentWrite = new WeakMap();

function noteWrite(dev, dpId, val) {
  let m = recentWrite.get(dev);
  if (!m) { m = new Map(); recentWrite.set(dev, m); }
  m.set(dpId, { val, until: Date.now() + WRITE_SQUELCH_MS });
}
function isRecentWrite(dev, dpId, val) {
  const m = recentWrite.get(dev);
  if (!m) return false;
  const rec = m.get(dpId);
  if (!rec) return false;
  if (Date.now() > rec.until) return false;
  return rec.val === val;
}

/** UI quiet window: suppress noisy echoes after backlight/name/screen bursts */
const UI_QUIET_DEFAULT_MS = 5000;
const uiQuiet = new WeakMap();
function beginUiQuiet(dev, ms = UI_QUIET_DEFAULT_MS) {
  const until = Date.now() + ms;
  const prev = uiQuiet.get(dev) || 0;
  uiQuiet.set(dev, Math.max(prev, until));
}
function inUiQuiet(dev) {
  const until = uiQuiet.get(dev) || 0;
  return Date.now() < until;
}

// ===============================================================================
// DPID MAPPINGS - VERIFIED THROUGH PACKET CAPTURE AND TESTING
// ===============================================================================

// Text field name DPIDs - Multiple field name formats supported
const DPID_L_NAME = {
  l1_name: 137, l2_name: 138, l3_name: 139, l4_name: 140,  // Short names
  switch_1_name: 137, switch_2_name: 138, switch_3_name: 139, switch_4_name: 140  // Tuya API names
};
const DPID_G_NAME = {
  g1_name: 125, g2_name: 126, g3_name: 127, g4_name: 128,  // Short names
  light_switch_name_1: 125, light_switch_name_2: 126, light_switch_name_3: 127, light_switch_name_4: 128  // Tuya API names
};
const DPID_C_NAME = {
  curtain1_name: 129, curtain2_name: 130, curtain3_name: 131, curtain4_name: 132,  // Short names
  curtain_switch_name_1: 129, curtain_switch_name_2: 130, curtain_switch_name_3: 131, curtain_switch_name_4: 132  // Tuya API names
};
const DPID_S_NAME = {
  scene1_name: 141, scene2_name: 142, scene3_name: 143, scene4_name: 144,
  scene5_name: 145, scene6_name: 146, scene7_name: 147, scene8_name: 148,
  scene_1_name: 141, scene_2_name: 142, scene_3_name: 143, scene_4_name: 144,
  scene_5_name: 145, scene_6_name: 146, scene_7_name: 147, scene_8_name: 148,
};
const NAME_DPIDS = {...DPID_L_NAME, ...DPID_G_NAME, ...DPID_C_NAME, ...DPID_S_NAME};

// A DPID may have both a short community name and a Tuya-compatible alias.
// Keep every alias together so an incoming RAW report cannot leave one key as
// a byte object while another key contains decoded text.
const NAME_KEYS_BY_DPID = new Map();
for (const [key, dpId] of Object.entries(NAME_DPIDS)) {
  if (!NAME_KEYS_BY_DPID.has(dpId)) NAME_KEYS_BY_DPID.set(dpId, []);
  NAME_KEYS_BY_DPID.get(dpId).push(key);
}

// Hidden-UI firmware sentinel. Keep this exactly eight characters: the panel
// name fields are limited to eight UTF-16 code units.
const HIDDEN_SENTINEL = '<hidden>';
const HIDDEN_TOGGLES = {
  // Fallback labels stay within the panel's eight-character write limit.
  dimmer1_hidden: {dpId: 125, nameKey: 'g1_name', aliasKey: 'light_switch_name_1', visibleName: 'Dimmer1'},
  dimmer2_hidden: {dpId: 126, nameKey: 'g2_name', aliasKey: 'light_switch_name_2', visibleName: 'Dimmer2'},
  dimmer3_hidden: {dpId: 127, nameKey: 'g3_name', aliasKey: 'light_switch_name_3', visibleName: 'Dimmer3'},
  dimmer4_hidden: {dpId: 128, nameKey: 'g4_name', aliasKey: 'light_switch_name_4', visibleName: 'Dimmer4'},
  curtain2_hidden: {dpId: 130, nameKey: 'curtain2_name', aliasKey: 'curtain_switch_name_2', visibleName: 'Curtain2'},
  curtain3_hidden: {dpId: 131, nameKey: 'curtain3_name', aliasKey: 'curtain_switch_name_3', visibleName: 'Curtain3'},
  curtain4_hidden: {dpId: 132, nameKey: 'curtain4_name', aliasKey: 'curtain_switch_name_4', visibleName: 'Curtain4'},
  scene1_hidden: {dpId: 141, nameKey: 'scene1_name', aliasKey: 'scene_1_name', visibleName: 'Scene 1'},
  scene2_hidden: {dpId: 142, nameKey: 'scene2_name', aliasKey: 'scene_2_name', visibleName: 'Scene 2'},
  scene3_hidden: {dpId: 143, nameKey: 'scene3_name', aliasKey: 'scene_3_name', visibleName: 'Scene 3'},
  scene4_hidden: {dpId: 144, nameKey: 'scene4_name', aliasKey: 'scene_4_name', visibleName: 'Scene 4'},
  scene5_hidden: {dpId: 145, nameKey: 'scene5_name', aliasKey: 'scene_5_name', visibleName: 'Scene 5'},
  scene6_hidden: {dpId: 146, nameKey: 'scene6_name', aliasKey: 'scene_6_name', visibleName: 'Scene 6'},
  scene7_hidden: {dpId: 147, nameKey: 'scene7_name', aliasKey: 'scene_7_name', visibleName: 'Scene 7'},
  scene8_hidden: {dpId: 148, nameKey: 'scene8_name', aliasKey: 'scene_8_name', visibleName: 'Scene 8'},
};
const HIDDEN_TOGGLE_BY_DPID = new Map(
  Object.entries(HIDDEN_TOGGLES).map(([key, value]) => [value.dpId, {key, ...value}]),
);

// Remember each item's last non-hidden name for as long as Zigbee2MQTT is
// running. After a restart while an item is hidden, OFF safely falls back to
// its factory label.
const hiddenPreviousNames = new WeakMap();
function rememberVisibleName(device, toggleKey, name) {
  if (!device || typeof name !== 'string' || !name || name === HIDDEN_SENTINEL ||
      name.startsWith('[object')) return;
  let names = hiddenPreviousNames.get(device);
  if (!names) { names = new Map(); hiddenPreviousNames.set(device, names); }
  names.set(toggleKey, name);
}
function previousVisibleName(device, toggleKey) {
  return hiddenPreviousNames.get(device)?.get(toggleKey);
}

// All control DPIDs for write-squelch tracking
const DPID_MAP = {
  state_l1:121, state_l2:122, state_l3:123, state_l4:124,
  brightness_g1:102, brightness_g2:103, brightness_g3:105, brightness_g4:107,
  color_temp_g1:109, color_temp_g2:110, color_temp_g3:111, color_temp_g4:112,
  backlight_switch:149,
  led_switch1:117, led_switch2:118, led_switch3:119, led_switch4:120,
  curtain_1_position:113, curtain_2_position:114,
  curtain_1_state:133, curtain_2_state:134,
  ...NAME_DPIDS,
};

// ===============================================================================
// CURTAIN CONTROL LOGIC
// ===============================================================================

const c1 = makeCurtainScaler();
const c2 = makeCurtainScaler();
const ocMap = { c1: {invert: true}, c2: {invert: true} };
const ocTarget = (isOpen, which) => (ocMap[which]?.invert ? (isOpen ? 0 : 100) : (isOpen ? 100 : 0));
const curtainStateFrom = (v) => (v===0||v==='0'||v==='open') ? 'OPEN' : (v===2||v==='2'||v==='close') ? 'CLOSED' : 'STOPPED';

// ===============================================================================
// UI QUIET AND NOISE FILTERING
// ===============================================================================

// Triggers that start UI quiet period
const QUIET_TRIGGER_IDS = new Set([149, 102,103,105,107, 109,110,111,112, 121,122,123,124]);

// Keys to filter out from responses (reduce noise)
const noisyKeys = new Set([
  'group_status','relay_status','state',
  'switch_1_name','switch_2_name','switch_3_name','switch_4_name',
  'light_switch_name_1','light_switch_name_2','light_switch_name_3','light_switch_name_4',
  'curtain_switch_name_1','name_encoding','name_pack','name_terminator',
  'scene_1_name','scene_2_name','scene_3_name','scene_4_name','scene_5_name',
]);

function dropUnknownCurtains(obj) {
  for (const k of Object.keys(obj)) {
    if (k.startsWith('curtain_3_') || k.startsWith('curtain_4_')) delete obj[k];
  }
}

// ===============================================================================
// FROMZIGBEE CONVERTER - HANDLES INCOMING DATA FROM PANEL
// ===============================================================================

const fzLocalDatapoints = {
  ...tuya.fz.datapoints,
  convert: (model, msg, publish, options, meta) => {
    const res0 = tuya.fz.datapoints.convert(model, msg, publish, options, meta) || {};
    const res = {...res0};

    // Normalise any name values already emitted by the stock Tuya RAW
    // converter. Without this, Z2M publishes {"0":48,...}; a later write can
    // turn that object into the literal text "[object Object]" on the panel.
    for (const [key, dpId] of Object.entries(NAME_DPIDS)) {
      if (!Object.prototype.hasOwnProperty.call(res, key)) continue;
      const decoded = decodeTuyaText(res[key]);
      for (const alias of NAME_KEYS_BY_DPID.get(dpId) || [key]) res[alias] = decoded;
    }

    // DP 149 is emitted by the panel's radar wake/idle handlers. Preserve the
    // existing backlight_switch property for backwards-compatible control,
    // while also publishing the incoming state as read-only occupancy.
    //
    // ON/1  = radar wake-up / presence
    // OFF/0 = radar idle / no presence
    if (Object.prototype.hasOwnProperty.call(res, 'backlight_switch')) {
      res.occupancy = res.backlight_switch === 'ON';
    }

    // Convert scene actions to standard action format
    for (let i = 1; i <= 8; i++) {
      const k = `action_scene_${i}`;
      if (Object.prototype.hasOwnProperty.call(res, k)) { res.action = `scene_${i}`; break; }
    }

    // Filter out noise and unused features
    for (const k of noisyKeys) { if (k in res) delete res[k]; }
    dropUnknownCurtains(res);

    // Process individual datapoints for special handling
    const dps = msg.data?.dpValues || msg.dpValues || msg.dataPoints || [];
    if (Array.isArray(dps)) {
      for (const dp of dps) {
        const id = dp.dp ?? dp.datapoint ?? dp.dpId ?? dp.id;
        const rawVal = dp.data ?? dp.value ?? dp.dpValue;

        // Start UI quiet period for backlight, dimmers, switches, or text fields
        if (QUIET_TRIGGER_IDS.has(id) || NAME_KEYS_BY_DPID.has(id)) beginUiQuiet(meta.device);

        // Decode text field names using the panel's ASCII-hex code-unit format.
        if (NAME_KEYS_BY_DPID.has(id)) {
          const decoded = decodeTuyaText(rawVal ?? '');
          for (const key of NAME_KEYS_BY_DPID.get(id)) res[key] = decoded;

          // Mirror each supported name DPID into its matching hidden toggle. The
          // sentinel comparison is deliberately exact and case-sensitive.
          const hiddenToggle = HIDDEN_TOGGLE_BY_DPID.get(id);
          if (hiddenToggle) {
            const hidden = decoded === HIDDEN_SENTINEL;
            res[hiddenToggle.key] = hidden ? 'ON' : 'OFF';
            if (!hidden) rememberVisibleName(meta.device, hiddenToggle.key, decoded);
          }
        }

        // Suppress recently written values to prevent echo loops
        const nVal = typeof rawVal === 'number' ? rawVal : (Number(rawVal) || rawVal);
        if (isRecentWrite(meta.device, id, nVal)) {
          for (const [k, dpId] of Object.entries(DPID_MAP)) {
            if (dpId === id && k in res) delete res[k];
          }
        }
      }
    }

    // IMPORTANT: Allow brightness/color temp data during UI quiet
    // Previous versions blocked this, causing automation failures
    // Keeping this section for reference but disabled

    // LED anti-fight protection
    for (let idx = 1; idx <= 4; idx++) {
      const k = `led_switch${idx}`;
      if (Object.prototype.hasOwnProperty.call(res, k)) {
        if (isLockedAgainst(meta.device, idx, res[k])) delete res[k];
      }
    }

    // Skip unchanged values to reduce MQTT traffic
    if (meta && meta.state) {
      for (const k of Object.keys(res)) {
        if (Object.prototype.hasOwnProperty.call(meta.state, k) && meta.state[k] === res[k]) {
          delete res[k];
        }
      }
    }

    return Object.keys(res).length ? res : undefined;
  },
};

// ===============================================================================
// TOZIGBEE CONVERTERS - HANDLE OUTGOING COMMANDS TO PANEL
// ===============================================================================

const tzLocal = {
  // Main converter for all panel controls
  filtered: {
    key: [
      'state_l1','state_l2','state_l3','state_l4',
      'brightness_g1','brightness_g2','brightness_g3','brightness_g4',
      'color_temp_g1','color_temp_g2','color_temp_g3','color_temp_g4',
      'backlight_switch','led_switch1','led_switch2','led_switch3','led_switch4',
      'curtain_1_position','curtain_2_position','curtain_1_state','curtain_2_state',
      ...Object.keys(HIDDEN_TOGGLES),
      ...Object.keys(NAME_DPIDS),
      'patcher_probe','patcher_frame',
    ],
    convertSet: async (entity, key, value, meta) => {
      if (meta && meta.message && Object.prototype.hasOwnProperty.call(meta.message, 'state')) {
        delete meta.message.state;
      }

      // v33 general staging protocol. Frames are safe printable ASCII and
      // are consumed before the stock Curtain-4 name decoder.
      if (key === 'patcher_frame') {
        const raw = String(value).trim().toUpperCase();
        if (!/^F3P3[BHDVCSR][0-9A-F]{6}[0-8][0-9A-F]{18}[0-9A-F]{2}$/.test(raw)) {
          throw new Error('patcher_frame must be one complete 32-character F3P3 frame');
        }
        const candidate = Buffer.from(raw, 'ascii');
        const expected = crc8Atm(candidate.subarray(0, 30)).toString(16).padStart(2, '0').toUpperCase();
        if (raw.slice(30) !== expected) throw new Error('patcher_frame CRC-8/ATM mismatch');
        await tuya.sendDataPointStringBuffer(entity, 132, raw);
        // Treat transport input as a command, not retained device state. This
        // allows the same frame to be retried without rebooting or editing it.
        return {state: {patcher_frame: ''}};
      }

      if (key === 'patcher_probe') {
        if (typeof value === 'object' && value !== null) {
          throw new Error('Refusing object patcher_probe value; expected text');
        }
        const next = String(value).trim().toUpperCase();
        if (!['P33STAGE', 'P33BEGIN', 'P33VERIFY', 'P33COMMIT', 'P33STATUS', 'P33META', 'P33REBOOT'].includes(next)) {
          throw new Error('patcher_probe accepts P33STAGE, P33BEGIN, P33VERIFY, P33COMMIT, P33STATUS, P33META, or P33REBOOT');
        }

        const sendFrame = async (opcode, offset = 0, payload = Buffer.alloc(0)) => {
          const frame = makePatcherV33Frame(opcode, offset, payload);
          meta?.logger?.info?.(
            `F3PRO v33 frame TX: opcode=${opcode} offset=${offset} frame=${frame.toString('ascii')}`,
          );
          await tuya.sendDataPointStringBuffer(entity, 132, frame.toString('ascii'));
        };

        if (next === 'P33BEGIN' || next === 'P33STAGE') {
          await sendFrame('B', PATCHER_TEST_PAYLOAD.length);
          await patcherDelay(400);
        }
        if (next === 'P33STAGE') {
          for (let offset = 0; offset < PATCHER_TEST_SHA256.length; offset += 8) {
            await sendFrame('H', offset, PATCHER_TEST_SHA256.subarray(offset, offset + 8));
            await patcherDelay(250);
          }
          for (let offset = 0; offset < PATCHER_TEST_PAYLOAD.length; offset += 8) {
            await sendFrame('D', offset, PATCHER_TEST_PAYLOAD.subarray(offset, offset + 8));
            await patcherDelay(250);
          }
          await sendFrame('V');
          await patcherDelay(750);
          await sendFrame('C');
        } else if (next === 'P33VERIFY') {
          await sendFrame('V');
        } else if (next === 'P33COMMIT') {
          await sendFrame('C');
        } else if (next === 'P33STATUS') {
          await sendFrame('S');
        } else if (next === 'P33META') {
          // A zero-length HASH frame is the v33.3 declared-size query.
          await sendFrame('H');
        } else if (next === 'P33REBOOT') {
          await sendFrame('R');
        }
        // Clear the command field after dispatch so STATUS/VERIFY/COMMIT and
        // repeated diagnostics can always be issued again.
        return {state: {patcher_probe: ''}};
      }

      // Hidden-UI convenience controls. ON writes the exact sentinel expected
      // by the patched firmware. OFF restores the last visible name observed
      // in this Z2M session, or its factory label as a safe fallback.
      if (HIDDEN_TOGGLES[key]) {
        const toggle = HIDDEN_TOGGLES[key];
        const enabled = value === true || value === 1 || String(value).toUpperCase() === 'ON';
        const stateName = [meta.state?.[toggle.nameKey], meta.state?.[toggle.aliasKey]]
          .find((candidate) => typeof candidate === 'string' && candidate &&
            candidate !== HIDDEN_SENTINEL && !candidate.startsWith('[object'));
        if (enabled && stateName && stateName !== HIDDEN_SENTINEL) {
          rememberVisibleName(meta.device, key, String(stateName));
        }
        const restoreName = previousVisibleName(meta.device, key) || toggle.visibleName;
        const next = enabled ? HIDDEN_SENTINEL : restoreName;
        const buf = encodeNameAsHexCodeUnits(next);

        meta?.logger?.info?.(
          `F3PRO name TX: key=${key} dp=${toggle.dpId} datatype=string text=${JSON.stringify(next)}`,
        );
        await sendEncodedName(entity, toggle.dpId, buf);
        noteWrite(meta.device, toggle.dpId, buf.toString('hex'));
        beginUiQuiet(meta.device);

        return {state: {
          [key]: enabled ? 'ON' : 'OFF',
          [toggle.nameKey]: next,
          [toggle.aliasKey]: next,
        }};
      }

      // TEXT FIELD HANDLING - 4-hex-digit-per-char encoding (see encodeNameAsHexCodeUnits for why)
      if (NAME_DPIDS[key] != null) {
        if (typeof value === 'object' && value !== null) {
          throw new Error(`Refusing object value for ${key}; expected text`);
        }
        const next = String(value).slice(0, 8); // Max 8 characters

        // Encode as ASCII-hex text - the panel's own DP handler decodes its
        // payload as hex-digit character pairs, not raw/UTF-16 bytes.
        const buf = encodeNameAsHexCodeUnits(next);
        const dpId = NAME_DPIDS[key];
        const datatype = STRING_NAME_DPIDS.has(dpId) ? 'string' : 'raw';
        meta?.logger?.info?.(
          `F3PRO name TX: key=${key} dp=${dpId} datatype=${datatype} text=${JSON.stringify(next)}`,
        );
        await sendEncodedName(entity, dpId, buf);
        noteWrite(meta.device, NAME_DPIDS[key], buf.toString('hex'));
        beginUiQuiet(meta.device);
        return {state: {[key]: next}};
      }

      // LED switch handling with anti-fight lock
      if (key.startsWith('led_switch')) {
        const idx = Number(key.slice(-1));
        const v = (String(value).toUpperCase() === 'ON') ? 'ON' : 'OFF';
        lockLed(meta.device, idx, v);
      }

      // Track recent writes for echo suppression
      const dpId = DPID_MAP[key];
      let recVal = value;
      if (typeof recVal !== 'number') {
        const n = Number(recVal);
        recVal = Number.isNaN(n) ? recVal : n;
      }
      if (dpId != null) noteWrite(meta.device, dpId, recVal);

      // Use standard Tuya datapoint converter for non-text fields
      return tuya.tz.datapoints.convertSet(entity, key, value, meta);
    },
  },

  // Special curtain state control via position
  curtain_state_via_position: {
    key: ['curtain_1_state', 'curtain_2_state'],
    convertSet: async (entity, key, value, meta) => {
      const isC1 = key === 'curtain_1_state';
      const posDp = isC1 ? 113 : 114;
      const stateDp = isC1 ? 133 : 134;
      const which = isC1 ? 'c1' : 'c2';
      const val = String(value).toUpperCase();

      if (val === 'OPEN') {
        const tgt = ocTarget(true, which);
        await tuya.sendDataPointValue(entity, posDp, tgt);
        noteWrite(meta.device, posDp, tgt);
      } else if (val === 'CLOSED' || val === 'CLOSE') {
        const tgt = ocTarget(false, which);
        await tuya.sendDataPointValue(entity, posDp, tgt);
        noteWrite(meta.device, posDp, tgt);
      } else {
        await tuya.sendDataPointEnum(entity, stateDp, 1); // STOP
        noteWrite(meta.device, stateDp, 1);
      }
      return {state: {[key]: (val === 'CLOSE') ? 'CLOSED' : val}};
    },
  },
};

// The F3-Pro is mains powered, but older interviews can leave its power source
// unknown. Zigbee2MQTT then applies the wrong availability behaviour. Keep a
// lightweight Basic-cluster read running as a real Zigbee check-in; this also
// gives the built-in availability service fresh evidence for its online icon.
const AVAILABILITY_PING_MS = 5 * 60 * 1000;
const availabilityPingTimers = new Map();

async function pingPanel(device, logger) {
  try {
    await device.getEndpoint(1).read('genBasic', ['zclVersion']);
  } catch (error) {
    logger?.debug?.(`F3PRO availability ping failed: ${error}`);
  }
}

function startAvailabilityPing(device, logger) {
  const key = device.ieeeAddr;
  if (availabilityPingTimers.has(key)) return;
  const timer = setInterval(() => void pingPanel(device, logger), AVAILABILITY_PING_MS);
  timer.unref?.();
  availabilityPingTimers.set(key, timer);
}

function stopAvailabilityPing(device) {
  const key = device.ieeeAddr;
  const timer = availabilityPingTimers.get(key);
  if (timer) clearInterval(timer);
  availabilityPingTimers.delete(key);
}

// ===============================================================================
// MAIN CONVERTER DEFINITION
// ===============================================================================

const definition = {
  // IMPORTANT: Update this fingerprint to match your specific device manufacturer(s)
  // Multiple manufacturer IDs confirmed for identical F3 PRO panels:
  fingerprint: [
    {modelID: 'TS0601', manufacturerName: '_TZE284_idn2htgu'},  // Primary manufacturer ID
    // ADD YOUR MANUFACTURER ID HERE if different:
    // {modelID: 'TS0601', manufacturerName: '_TZE284_your_id_here'},
  ],
  model: 'F3PRO_TouchPanel',
  vendor: 'Tuya',
  description: 'F3 PRO Touchpanel with full text field support, curtain control, and dimmer management',

  fromZigbee: [fzLocalDatapoints, ...(weatherExtension.fromZigbee || [])],
  toZigbee: [
    tzLocal.curtain_state_via_position,
    tzLocal.filtered,
    ...weatherToZigbee,
  ],

  // Event handler to manage UI quiet periods
  onEvent: async (type, data, device, settings, state) => {
    // The custom event handler previously replaced Tuya's clock responder,
    // leaving the panel time stale. Restore local-time synchronisation while
    // preserving the converter's UI quiet handling.
    try {
      await tuya.onEventSetLocalTime(type, data, device, settings, state);
    } catch (_) {}

    if (type === 'start') startAvailabilityPing(device, data?.logger);
    if (type === 'stop') stopAvailabilityPing(device);

    try {
      if (type !== 'message' || !data) return;
      const dps = data.data?.dpValues || data.dpValues || data.dataPoints || [];
      if (!Array.isArray(dps) || dps.length === 0) return;
      for (const dp of dps) {
        const id = dp.dp ?? dp.datapoint ?? dp.dpId ?? dp.id;
        if (id === 149 || QUIET_TRIGGER_IDS.has(id)) beginUiQuiet(device);
      }
    } catch (_) {}
  },

  // Complete expose definition for Home Assistant integration
  exposes: [
    // Relay switches L1-L4
    exposes.binary('state_l1', ea.STATE_SET, 'ON', 'OFF').withDescription('L1 relay switch'),
    exposes.binary('state_l2', ea.STATE_SET, 'ON', 'OFF').withDescription('L2 relay switch'),
    exposes.binary('state_l3', ea.STATE_SET, 'ON', 'OFF').withDescription('L3 relay switch'),
    exposes.binary('state_l4', ea.STATE_SET, 'ON', 'OFF').withDescription('L4 relay switch'),

    // Scene actions
    e.action(['scene_1','scene_2','scene_3','scene_4','scene_5','scene_6','scene_7','scene_8']).withDescription('Scene button pressed'),

    // Dimmer groups G1-G4 with brightness and color temperature
    e.numeric('brightness_g1', ea.STATE_SET).withUnit('%').withValueMin(1).withValueMax(100).withDescription('G1 brightness'),
    e.numeric('color_temp_g1', ea.STATE_SET).withUnit('%').withValueMin(0).withValueMax(100).withDescription('G1 color temperature'),
    e.numeric('brightness_g2', ea.STATE_SET).withUnit('%').withValueMin(1).withValueMax(100).withDescription('G2 brightness'),
    e.numeric('color_temp_g2', ea.STATE_SET).withUnit('%').withValueMin(0).withValueMax(100).withDescription('G2 color temperature'),
    e.numeric('brightness_g3', ea.STATE_SET).withUnit('%').withValueMin(1).withValueMax(100).withDescription('G3 brightness'),
    e.numeric('color_temp_g3', ea.STATE_SET).withUnit('%').withValueMin(0).withValueMax(100).withDescription('G3 color temperature'),
    e.numeric('brightness_g4', ea.STATE_SET).withUnit('%').withValueMin(1).withValueMax(100).withDescription('G4 brightness'),
    e.numeric('color_temp_g4', ea.STATE_SET).withUnit('%').withValueMin(0).withValueMax(100).withDescription('G4 color temperature'),

    // Curtain controls
    e.numeric('curtain_1_position', ea.STATE_SET).withValueMin(0).withValueMax(100).withDescription('Curtain 1 position %'),
    e.enum('curtain_1_state', ea.STATE_SET, ['OPEN','STOPPED','CLOSED']).withDescription('Curtain 1 state control'),
    e.numeric('curtain_2_position', ea.STATE_SET).withValueMin(0).withValueMax(100).withDescription('Curtain 2 position %'),
    e.enum('curtain_2_state', ea.STATE_SET, ['OPEN','STOPPED','CLOSED']).withDescription('Curtain 2 state control'),

    // Radar presence (read only). DP 149 is shared with the panel backlight
    // state, so this represents radar-active/display-awake until its idle timer.
    e.occupancy().withDescription('Radar activity derived from DP 149; clears when the panel enters radar idle'),

    // Panel controls
    exposes.binary('backlight_switch', ea.STATE_SET, 'ON', 'OFF').withDescription('Panel backlight'),
    exposes.binary('led_switch1', ea.STATE_SET, 'ON', 'OFF').withDescription('LED switch 1'),
    exposes.binary('led_switch2', ea.STATE_SET, 'ON', 'OFF').withDescription('LED switch 2'),
    exposes.binary('led_switch3', ea.STATE_SET, 'ON', 'OFF').withDescription('LED switch 3'),
    exposes.binary('led_switch4', ea.STATE_SET, 'ON', 'OFF').withDescription('LED switch 4'),

    // Weather values shown by the panel. Send both in one MQTT /set payload
    // so the native weather helper can build a complete synchronisation frame.
    e.numeric('temperature_1', ea.STATE_SET)
      .withUnit('°C').withValueMin(-65).withValueMax(99).withValueStep(0.1)
      .withDescription('Outdoor temperature displayed on the panel'),
    e.enum('condition_1', ea.STATE_SET, F3PRO_WEATHER_CONDITIONS)
      .withDescription('Weather condition displayed on the panel'),

    exposes.text('patcher_probe', ea.STATE_SET)
      .withDescription('v35.4 patcher commands include P33STATUS, P33META and P33REBOOT'),
    exposes.text('patcher_frame', ea.STATE_SET)
      .withDescription('Advanced v33 raw framed transport for the supplied file-staging script'),

    // TEXT FIELDS - working in Z2M/Home Assistant and on the panel display
    // Short name format
    exposes.text('l1_name', ea.STATE_SET).withDescription('L1 switch custom name'),
    exposes.text('l2_name', ea.STATE_SET).withDescription('L2 switch custom name'),
    exposes.text('l3_name', ea.STATE_SET).withDescription('L3 switch custom name'),
    exposes.text('l4_name', ea.STATE_SET).withDescription('L4 switch custom name'),
    exposes.text('g1_name', ea.STATE_SET).withDescription('G1 dimmer custom name'),
    exposes.text('g2_name', ea.STATE_SET).withDescription('G2 dimmer custom name'),
    exposes.text('g3_name', ea.STATE_SET).withDescription('G3 dimmer custom name'),
    exposes.text('g4_name', ea.STATE_SET).withDescription('G4 dimmer custom name'),
    exposes.text('curtain1_name', ea.STATE_SET).withDescription('Curtain 1 custom name'),
    exposes.text('curtain2_name', ea.STATE_SET).withDescription('Curtain 2 custom name'),
    exposes.text('curtain3_name', ea.STATE_SET).withDescription('Curtain 3 custom name'),
    exposes.text('curtain4_name', ea.STATE_SET).withDescription('Curtain 4 custom name'),
    exposes.text('scene1_name', ea.STATE_SET).withDescription('Scene 1 custom name'),
    exposes.text('scene2_name', ea.STATE_SET).withDescription('Scene 2 custom name'),
    exposes.text('scene3_name', ea.STATE_SET).withDescription('Scene 3 custom name'),
    exposes.text('scene4_name', ea.STATE_SET).withDescription('Scene 4 custom name'),
    exposes.text('scene5_name', ea.STATE_SET).withDescription('Scene 5 custom name'),
    exposes.text('scene6_name', ea.STATE_SET).withDescription('Scene 6 custom name'),
    exposes.text('scene7_name', ea.STATE_SET).withDescription('Scene 7 custom name'),
    exposes.text('scene8_name', ea.STATE_SET).withDescription('Scene 8 custom name'),

    // Tuya API compatible name format (same functionality, different field names)
    exposes.text('switch_1_name', ea.STATE_SET).withDescription('Switch 1 name (Tuya API format)'),
    exposes.text('switch_2_name', ea.STATE_SET).withDescription('Switch 2 name (Tuya API format)'),
    exposes.text('switch_3_name', ea.STATE_SET).withDescription('Switch 3 name (Tuya API format)'),
    exposes.text('switch_4_name', ea.STATE_SET).withDescription('Switch 4 name (Tuya API format)'),
    exposes.text('light_switch_name_1', ea.STATE_SET).withDescription('Light switch 1 name (Tuya API format)'),
    exposes.text('light_switch_name_2', ea.STATE_SET).withDescription('Light switch 2 name (Tuya API format)'),
    exposes.text('light_switch_name_3', ea.STATE_SET).withDescription('Light switch 3 name (Tuya API format)'),
    exposes.text('light_switch_name_4', ea.STATE_SET).withDescription('Light switch 4 name (Tuya API format)'),
    exposes.text('scene_1_name', ea.STATE_SET).withDescription('Scene 1 name (Tuya API format)'),
    exposes.text('scene_2_name', ea.STATE_SET).withDescription('Scene 2 name (Tuya API format)'),
    exposes.text('scene_3_name', ea.STATE_SET).withDescription('Scene 3 name (Tuya API format)'),
    exposes.text('scene_4_name', ea.STATE_SET).withDescription('Scene 4 name (Tuya API format)'),
    exposes.text('scene_5_name', ea.STATE_SET).withDescription('Scene 5 name (Tuya API format)'),
    exposes.text('scene_6_name', ea.STATE_SET).withDescription('Scene 6 name (Tuya API format)'),
    exposes.text('scene_7_name', ea.STATE_SET).withDescription('Scene 7 name (Tuya API format)'),
    exposes.text('scene_8_name', ea.STATE_SET).withDescription('Scene 8 name (Tuya API format)'),

    // Hidden-UI controls are deliberately last so the Zigbee2MQTT dashboard
    // keeps normal controls, weather, diagnostics and names together above.
    exposes.binary('dimmer1_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Dimmer 1 from v41 pager navigation'),
    exposes.binary('dimmer2_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Dimmer 2 from v41 pager navigation'),
    exposes.binary('dimmer3_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Dimmer 3 from v41 pager navigation'),
    exposes.binary('dimmer4_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Dimmer 4 from v41 pager navigation'),
    exposes.binary('curtain2_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Curtain 2 controls from the patched panel UI'),
    exposes.binary('curtain3_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Curtain 3 controls from the patched panel UI'),
    exposes.binary('curtain4_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Curtain 4 controls from the patched panel UI'),
    exposes.binary('scene1_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 1 from the patched panel UI'),
    exposes.binary('scene2_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 2 from the patched panel UI'),
    exposes.binary('scene3_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 3 from the patched panel UI'),
    exposes.binary('scene4_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 4 from the patched panel UI'),
    exposes.binary('scene5_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 5 from the patched panel UI'),
    exposes.binary('scene6_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 6 from the patched panel UI'),
    exposes.binary('scene7_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 7 from the patched panel UI'),
    exposes.binary('scene8_hidden', ea.STATE_SET, 'ON', 'OFF')
      .withDescription('Hide Scene 8 from the patched panel UI'),
  ],

  meta: {
    multiEndpoint: true,
    disableDefaultResponse: true,
    publishDuplicateTransaction: false,
    tuyaDatapoints: [
      // Relay switches
      [121,'state_l1',tuya.valueConverter.onOff],
      [122,'state_l2',tuya.valueConverter.onOff],
      [123,'state_l3',tuya.valueConverter.onOff],
      [124,'state_l4',tuya.valueConverter.onOff],

      // Scene actions
      [1,'action_scene_1',tuya.valueConverter.raw],
      [2,'action_scene_2',tuya.valueConverter.raw],
      [3,'action_scene_3',tuya.valueConverter.raw],
      [4,'action_scene_4',tuya.valueConverter.raw],
      [5,'action_scene_5',tuya.valueConverter.raw],
      [6,'action_scene_6',tuya.valueConverter.raw],
      [7,'action_scene_7',tuya.valueConverter.raw],
      [8,'action_scene_8',tuya.valueConverter.raw],

      // Dimmer groups with LED gating
      [102,'brightness_g1',dimmerPct('led_switch1')],
      [103,'brightness_g2',dimmerPct('led_switch2')],
      [105,'brightness_g3',dimmerPct('led_switch3')],
      [107,'brightness_g4',dimmerPct('led_switch4')],
      [109,'color_temp_g1',dimmerConverter('led_switch1')],
      [110,'color_temp_g2',dimmerConverter('led_switch2')],
      [111,'color_temp_g3',dimmerConverter('led_switch3')],
      [112,'color_temp_g4',dimmerConverter('led_switch4')],

      // Curtain controls
      [113,'curtain_1_position',{from:c1.from,to:c1.to}],
      [114,'curtain_2_position',{from:c2.from,to:c2.to}],
      [133,'curtain_1_state',{from:curtainStateFrom,to:(v)=>v}],
      [134,'curtain_2_state',{from:curtainStateFrom,to:(v)=>v}],

      // Panel controls
      [149,'backlight_switch',tuya.valueConverter.onOff],
      [117,'led_switch1',tuya.valueConverter.onOff],
      [118,'led_switch2',tuya.valueConverter.onOff],
      [119,'led_switch3',tuya.valueConverter.onOff],
      [120,'led_switch4',tuya.valueConverter.onOff],

      // Text fields - selective tuyaDatapoints to avoid conflicts with custom handler
      // Only include non-conflicting DPIDs for fromZigbee reading
      [137,'l1_name',tuya.valueConverter.raw],
      [139,'l3_name',tuya.valueConverter.raw],
      [140,'l4_name',tuya.valueConverter.raw],
      [125,'g1_name',tuya.valueConverter.raw],
      [127,'g3_name',tuya.valueConverter.raw],
      [128,'g4_name',tuya.valueConverter.raw],
      [129,'curtain1_name',tuya.valueConverter.raw],
      [130,'curtain2_name',tuya.valueConverter.raw],
      [131,'curtain3_name',tuya.valueConverter.raw],
      [132,'curtain4_name',tuya.valueConverter.raw],
      [143,'scene3_name',tuya.valueConverter.raw],
      [144,'scene4_name',tuya.valueConverter.raw],
      [145,'scene5_name',tuya.valueConverter.raw],
      [146,'scene6_name',tuya.valueConverter.raw],
      [147,'scene7_name',tuya.valueConverter.raw],
      [148,'scene8_name',tuya.valueConverter.raw],
      // Note: Some DPIDs commented out to prevent conflicts with custom toZigbee handler
      // All text fields still work through the custom converter
    ],
  },

  configure: async (device, coordinatorEndpoint) => {
    const ep = device.getEndpoint(1);
    await reporting.bind(ep, coordinatorEndpoint, ['genBasic','genGroups','genScenes']);
    if (device.powerSource !== 'Mains (single phase)') {
      device.powerSource = 'Mains (single phase)';
      await device.save();
    }
    await pingPanel(device);
  },
};

module.exports = definition;
