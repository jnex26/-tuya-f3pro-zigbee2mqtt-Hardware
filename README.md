# Tuya F3 PRO Touchpanel - Complete Zigbee2MQTT Converter

A fully functional external converter for Tuya F3 PRO touchpanels (_TZE284_idn2htgu) with comprehensive Home Assistant integration.

## 🎯 Project Status: **PRODUCTION READY**

After months of reverse engineering, packet capture analysis, and systematic testing, this converter provides complete automation integration for Tuya F3 PRO touchpanels.

## ✅ What Works (100% Functional)

- ✅ **All 4 relay switches** (L1-L4) with individual LED indicators
- ✅ **All 4 dimmer groups** (G1-G4) with brightness and color temperature control
- ✅ **2 curtain controllers** with position and state control
- ✅ **8 scene buttons** with action detection
- ✅ **Panel backlight control**
- ✅ **ALL 20+ text fields** for custom naming - **PERFECT Home Assistant integration**
  - Two-way synchronization between panel and Z2M
  - Multiple field name formats supported (l1_name, switch_1_name, etc.)
  - Ideal for automation logic and dashboard customization

## ⚠️ Known Limitations & Workarounds

### 1. **Text Field Display**
- **Issue**: Text fields show rectangles on physical panel display
- **Root Cause**: Panel firmware font rendering limitation
- **Impact**: None for Home Assistant - automation integration is perfect
- **Status**: Acceptable limitation for HA users

### 2. **Radar Functionality** ❌
- **Issue**: Radar/presence detection not working through Z2M converter
- **Status**: Not implemented in this converter
- **Workaround**: Use dedicated radar sensors for presence detection

### 3. **Time Synchronization** ⚠️ **CRITICAL ISSUE**
- **Issue**: Panel loses approximately 1 minute per day, 5-7 minutes per week
- **Root Cause**: No time sync via Zigbee protocol in Z2M mode
- **Impact**: Panel clock becomes increasingly inaccurate

#### **Weekly Maintenance Workaround** (Tested Solution):
1. **Reset and pair with Tuya Smart Life app** (once per week)
2. **Time syncs automatically** via Smart Life
3. **Delete from Smart Life** and **re-pair with Z2M**
4. **✅ All settings preserved** - only time gets corrected
5. **Repeat weekly** to maintain accurate time

#### **Power Outage Impact**:
- **Issue**: Panel defaults to factory time after power cuts
- **Solution**: Repeat the Smart Life sync process immediately after power restoration

## 🔧 Installation

### 1. Download Converter
Save `tuya_f3pro_touchpanel_converter.js` to your Zigbee2MQTT `data/external_converters/` directory.

### 2. Update Configuration
Add to your Zigbee2MQTT `configuration.yaml`:
```yaml
external_converters:
  - tuya_f3pro_touchpanel_converter.js
```

### 3. Customize for Your Device
Edit line 45 in the converter file:
```javascript
fingerprint: [{modelID: 'TS0601', manufacturerName: '_TZE284_YOUR_MANUFACTURER_ID'}]
```

### 4. Restart & Re-interview
1. Restart Zigbee2MQTT
2. Remove your touchpanel from Z2M
3. Re-interview the device

## 📱 Device Compatibility

**Confirmed Working:**
- Model: F3 PRO Touch Panel
- Primary Manufacturer: `_TZE284_idn2htgu`
- Secondary Manufacturer: `_TZE284_xxxxxxxx` (different ID found on third panel)

**⚠️ IMPORTANT - Multiple Manufacturer IDs:**
Even **identical F3 PRO panels** may have **different manufacturer IDs** in Zigbee2MQTT. In our testing:
- **2 panels**: `_TZE284_idn2htgu`
- **1 panel**: Different `_TZE284_xxxxxxxx` code

**Always check your specific device's manufacturer ID in Z2M before using this converter!**

**Likely Compatible** (update manufacturer ID):
- Other Tuya F3 PRO variants with different manufacturer codes
- Similar Tuya touchpanels with same DPID structure

## 🏠 Home Assistant Integration Examples

### Text Field Automation
```yaml
automation:
  - alias: "Set Panel Names"
    trigger:
      platform: homeassistant
      event: start
    action:
      - service: mqtt.publish
        data:
          topic: "zigbee2mqtt/TouchPanel/set"
          payload: '{"l1_name": "Lights", "l2_name": "Fan", "scene1_name": "Movie"}'
```

### Scene Control
```yaml
automation:
  - alias: "Panel Scene Triggers"
    trigger:
      - platform: mqtt
        topic: "zigbee2mqtt/TouchPanel"
    condition:
      condition: template
      value_template: "{{ 'action' in trigger.payload_json }}"
    action:
      - service: script.turn_on
        target:
          entity_id: "script.{{ trigger.payload_json.action }}"
```

### Dimmer Control
```yaml
automation:
  - alias: "Sync Panel Dimmers to Lights"
    trigger:
      - platform: state
        entity_id: number.touchpanel_brightness_g1
    action:
      - service: light.turn_on
        target:
          entity_id: light.bedroom_lights
        data:
          brightness_pct: "{{ trigger.to_state.state }}"
```

## 🧪 Technical Details

### DPID Mappings (Verified)
- **Switches**: 121-124 (control), 137-140 (names)
- **Dimmers**: 102,103,105,107 (brightness), 109-112 (color temp), 125-128 (names)
- **Curtains**: 113-114 (position), 133-134 (state), 129-132 (names)
- **Scenes**: 1-8 (actions), 141,32,143-148 (names)
- **Special**: Scene 2 uses DPID 32 (not 142 as in API documentation)

### Text Encoding
- **Method**: UTF-16LE encoding (proven optimal)
- **Testing**: 10 different encoding approaches tested
- **Result**: Perfect Z2M integration, rectangles on panel display

## 🔬 Development History

This converter represents extensive reverse engineering work:
- **Packet capture analysis** using CC2531 sniffer
- **DPID discovery** through systematic testing
- **Encoding experiments** (UTF-16LE, ASCII, UTF-8, hex variants)
- **Integration optimization** for Home Assistant
- **Real-world testing** across multiple scenarios

## 🤝 Community Contribution

### Contributing
- **Issues**: Report device compatibility or bugs
- **Pull Requests**: Improvements and additional features welcome
- **Testing**: Help test with different manufacturer variants

### Acknowledgments
- Zigbee2MQTT community for the excellent framework
- Tuya reverse engineering community
- Home Assistant community for integration testing

## 📞 Support

### Before Opening Issues:
1. ✅ Verify your manufacturer ID matches the fingerprint
2. ✅ Confirm external converters are loading (check Z2M logs)
3. ✅ Try device re-interview after converter installation

### Known Working Setups:
- **Home Assistant**: 2024.x
- **Zigbee2MQTT**: 1.39.x+
- **Hardware**: CC2531, CC2652R, Sonoff dongles

## 📄 License

MIT License - Feel free to use, modify, and distribute.

---

**⭐ If this converter helped you, please star the repository to help others find it!**

*Made with ❤️ by the Home Assistant community*