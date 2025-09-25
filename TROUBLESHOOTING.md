# Troubleshooting Guide

## 🚨 Most Common Issue: Wrong Manufacturer ID

### Problem: Device Not Recognized by Converter

**Symptoms:**
- Device pairs with Z2M but uses generic "TS0601" converter
- Missing text fields and advanced features
- Only basic switch/dimmer functionality available

**Root Cause:**
**Even identical F3 PRO panels have different manufacturer IDs!** Our testing confirmed:
- 2 panels: `_TZE284_idn2htgu`
- 1 panel: `_TZE284_xxxxxxxx` (different code)

### ✅ Solution: Find and Update Manufacturer ID

1. **Find Your Exact Manufacturer ID:**
   ```
   Zigbee2MQTT Web UI → Devices → [Your Panel] → About Tab
   Look for: Manufacturer: _TZE284_xxxxxxxxx
   ```

2. **Update Converter Fingerprint:**
   Edit `tuya_f3pro_touchpanel_converter.js` line ~425:
   ```javascript
   fingerprint: [
     {modelID: 'TS0601', manufacturerName: '_TZE284_idn2htgu'},
     {modelID: 'TS0601', manufacturerName: '_TZE284_YOUR_ID_HERE'},  // Add this line
   ],
   ```

3. **Restart Z2M and Re-interview Device**

## 🔧 Other Common Issues

### Converter Not Loading

**Check Z2M Logs:**
```
[ERROR] Failed to load external converter: tuya_f3pro_touchpanel_converter.js
```

**Solutions:**
- ✅ Verify file path: `data/external_converters/tuya_f3pro_touchpanel_converter.js`
- ✅ Check file permissions (readable by Z2M user)
- ✅ Verify configuration.yaml syntax:
  ```yaml
  external_converters:
    - tuya_f3pro_touchpanel_converter.js  # Exact filename
  ```

### Device Interview Fails

**Symptoms:**
- Device appears in Z2M but shows "Interviewing..."
- Interview eventually fails or times out

**Solutions:**
- ✅ Put device in pairing mode DURING interview
- ✅ Move device closer to coordinator during pairing
- ✅ Clear Z2M database entry and re-pair fresh
- ✅ Factory reset panel if previously paired elsewhere

### Text Fields Not Working

**Symptoms:**
- Control functions work (switches, dimmers, scenes)
- Text field entities missing in Home Assistant
- Cannot set custom names

**Check:**
- ✅ Device re-interviewed with correct manufacturer ID
- ✅ Z2M logs show text field datapoints (125, 137, etc.)
- ✅ Home Assistant restarted after Z2M setup

**Test Command:**
```bash
mosquitto_pub -h YOUR_HA_IP -t "zigbee2mqtt/YOUR_PANEL/set" -m '{"l1_name": "Test"}'
```

### Time Sync Issues

See dedicated **TIME_SYNC_WORKAROUND.md** for complete solution.

### Scene Actions Not Triggering

**Symptoms:**
- Scene buttons pressed but no Home Assistant events
- Missing action entities

**Check Z2M Logs:**
```
[INFO] Received Zigbee message from 'TouchPanel', type 'attributeReport'
```

**Solutions:**
- ✅ Verify scene datapoints 1-8 in converter mapping
- ✅ Check HA automation triggers listen for correct action format
- ✅ Test with MQTT debugging enabled

## 📊 Diagnostic Commands

### Check Z2M Converter Loading
```bash
# Look for converter in Z2M logs
grep -i "external converter" /path/to/z2m/log/log.txt
```

### Verify MQTT Topics
```bash
# Monitor all panel MQTT messages
mosquitto_sub -h YOUR_HA_IP -t "zigbee2mqtt/YOUR_PANEL/#" -v
```

### Test Text Field Functionality
```bash
# Set L1 name via MQTT
mosquitto_pub -h YOUR_HA_IP -t "zigbee2mqtt/YOUR_PANEL/set" -m '{"l1_name": "TestName"}'

# Check response
mosquitto_sub -h YOUR_HA_IP -t "zigbee2mqtt/YOUR_PANEL" -v
```

## 🐛 Debug Mode

Enable detailed logging in Z2M configuration.yaml:
```yaml
advanced:
  log_level: debug
  log_output:
    - console
    - file
```

**Look for these log entries:**
- External converter loading
- Device fingerprint matching
- Datapoint parsing (DPIDs 121-148)
- Text field encoding/decoding

## 📝 Creating Support Issues

When opening GitHub issues, include:

1. **Z2M Version**: `zigbee2mqtt --version`
2. **Device Info**: Manufacturer ID, model, firmware version
3. **Z2M Logs**: Relevant log sections (with debug enabled)
4. **Converter Location**: Full file path
5. **Configuration**: Z2M configuration.yaml (remove sensitive data)

### Log Template:
```
Z2M Version: 1.xx.x
Device Manufacturer: _TZE284_xxxxxxxxx
Issue: [Brief description]

Logs:
[Paste relevant Z2M log sections]

Configuration:
[Paste relevant config sections]
```

## 🔄 Clean Reinstall Process

If all else fails, complete clean reinstall:

1. **Remove device** from Z2M (don't factory reset panel)
2. **Delete Z2M database entry** for the device
3. **Remove old converter** file
4. **Install fresh converter** with correct manufacturer ID
5. **Restart Z2M**
6. **Clear browser cache** (Z2M web interface)
7. **Re-pair device** in fresh pairing mode
8. **Restart Home Assistant**

This process ensures no cached states interfere with proper converter loading.