# Installation Guide

## Prerequisites

- **Zigbee2MQTT** version 1.39.x or higher
- **Home Assistant** (optional but recommended)
- **Tuya F3 PRO Touchpanel** with manufacturer ID `_TZE284_idn2htgu` or similar

## Step-by-Step Installation

### 1. Download the Converter

Download `tuya_f3pro_touchpanel_converter.js` and save it to your Zigbee2MQTT external converters directory:

```
/path/to/zigbee2mqtt/data/external_converters/tuya_f3pro_touchpanel_converter.js
```

**Common Paths:**
- **Home Assistant Add-on**: `/config/zigbee2mqtt/external_converters/`
- **Docker**: `/app/data/external_converters/`
- **Native Install**: `./data/external_converters/`

### 2. Configure Zigbee2MQTT

Edit your `configuration.yaml` file and add the external converter:

```yaml
# Zigbee2MQTT Configuration
external_converters:
  - tuya_f3pro_touchpanel_converter.js

# Optional: Enable debug logging for troubleshooting
advanced:
  log_level: debug  # Remove after successful setup
```

### 3. Customize for Your Device

**⚠️ CRITICAL STEP - Multiple Manufacturer IDs Exist:**

Even **identical F3 PRO panels** can have **different manufacturer IDs**! Our testing revealed:
- **2 panels**: `_TZE284_idn2htgu`
- **1 panel**: Different `_TZE284_xxxxxxxx` manufacturer ID

**You MUST check and update the manufacturer ID:**

1. **Find Your Device's Manufacturer ID:**
   - Go to Z2M web interface
   - Click on your touchpanel device
   - Look for "Manufacturer" field
   - Copy the exact manufacturer string (e.g., `_TZE284_abc123xyz`)

2. **Update the Converter:**
   - Open `tuya_f3pro_touchpanel_converter.js`
   - Find line 45 (fingerprint section):
     ```javascript
     fingerprint: [{modelID: 'TS0601', manufacturerName: '_TZE284_idn2htgu'}]
     ```
   - Replace `_TZE284_idn2htgu` with YOUR device's exact manufacturer ID

3. **Multiple Panels Solution:**
   If you have multiple panels with different manufacturer IDs, use an array:
   ```javascript
   fingerprint: [
     {modelID: 'TS0601', manufacturerName: '_TZE284_idn2htgu'},
     {modelID: 'TS0601', manufacturerName: '_TZE284_your_other_id'}
   ]
   ```

### 4. Restart Zigbee2MQTT

```bash
# Home Assistant Add-on
ha addons restart 45df7312_zigbee2mqtt

# Docker
docker restart zigbee2mqtt

# Native
sudo systemctl restart zigbee2mqtt
```

### 5. Verify Converter Loading

Check Z2M logs for successful loading:
```
[INFO] External converter 'tuya_f3pro_touchpanel_converter.js' loaded successfully
```

### 6. Re-interview Your Device

**CRITICAL**: You must re-interview your touchpanel for the converter to take effect:

1. **Remove device** from Zigbee2MQTT (don't factory reset the panel)
2. **Start pairing mode** in Z2M
3. **Put panel in pairing mode** (usually hold a button combination)
4. **Wait for discovery** and device interview

### 7. Verify Integration

After successful pairing, you should see all entities in Home Assistant:

**Switches**: `switch.touchpanel_state_l1` through `switch.touchpanel_state_l4`
**Dimmers**: `number.touchpanel_brightness_g1` through `number.touchpanel_brightness_g4`
**Text Fields**: `text.touchpanel_l1_name` through `text.touchpanel_scene8_name`
**Scenes**: Action events for `scene_1` through `scene_8`

## Troubleshooting

### Converter Not Loading
- ✅ Check file path and permissions
- ✅ Verify YAML syntax in configuration.yaml
- ✅ Check Z2M logs for error messages
- ✅ Ensure filename exactly matches config entry

### Device Not Recognized
- ✅ Verify manufacturer ID in fingerprint
- ✅ Ensure device is in pairing mode during interview
- ✅ Check Z2M logs for device information
- ✅ Try factory reset if device was previously paired

### Entities Not Appearing
- ✅ Confirm device was re-interviewed (not just added)
- ✅ Restart Home Assistant after Z2M setup
- ✅ Check HA logs for MQTT entity creation
- ✅ Verify Z2M MQTT topics are being published

### Time Sync Issues
- ✅ This is a known limitation - see main README
- ✅ Use the weekly Smart Life sync workaround
- ✅ Plan for immediate sync after power outages

## Advanced Configuration

### Custom Entity Names
Configure custom entity names in Home Assistant:
```yaml
# configuration.yaml
mqtt:
  text:
    - name: "Bedroom Panel L1 Name"
      state_topic: "zigbee2mqtt/TouchPanel"
      command_topic: "zigbee2mqtt/TouchPanel/set"
      value_template: "{{ value_json.l1_name }}"
      command_template: '{"l1_name": "{{ value }}"}'
```

### Automation Templates
See the main README for complete automation examples.

## Migration from Smart Life

If migrating from Tuya Smart Life:

1. **Note current settings** (names, scenes, etc.)
2. **Remove from Smart Life** app
3. **Install Z2M converter** (this guide)
4. **Pair with Z2M**
5. **Restore settings** via Home Assistant automations
6. **Set up weekly time sync** routine (see README)

## Support

- **Issues**: Open GitHub issue with Z2M logs
- **Questions**: Check README or start GitHub discussion
- **Hardware**: Ensure compatible Zigbee coordinator