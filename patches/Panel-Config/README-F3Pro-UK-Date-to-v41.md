# Tuya F3-Pro UK Date to v41 Patcher

This package upgrades the exact UK-date test firmware to the hardware-validated
v41 firmware without requiring the intermediate experimental builds.

## Supported input

```text
File:    Tuya_F3_Pro_UK_Date_Test.bin
Size:    8388608 bytes
SHA-256: 4dd0f94097904134454ecf4270ac0908c41d0482d326f9073cada5f518dbe547
```

The patcher refuses every other input image. It never modifies the input file.

## Generated output

```text
File:    Tuya_F3_Pro_v41_DimPagerSkip.bin
Size:    8388608 bytes
SHA-256: a23e4a6ea74cf490b45e8a96652ba50d11546bd8b54ef30d2bd9ed7b6a8599ed
```

The output is byte-for-byte identical to the v41 image tested on the physical
panel.

## Included cumulative functionality

- UK date formatting.
- Scene and curtain `<hidden>` handling.
- Safe curtain rename path.
- Curtain 3/4 page redirect and corrected slider ownership.
- Zigbee staging transport, boot-time manifest executor and `P33REBOOT`.
- Relay decoupling with physical presses exposed as `button_5`–`button_8`.
- Pre-transition dimmer pager skipping for individual and consecutive hidden
  dimmers.
- Safe navigation cancellation when only one dimmer remains visible.

Hardware validation completed for v41:

- forward and backward skipping;
- consecutive hidden dimmers;
- only one visible dimmer;
- persistence across reboot;
- no blank screen, crash or watchdog reset during those tests.

## Use

Keep all three package files together, then run:

```bash
python3 patch_f3pro_uk_date_to_v41.py \
  Tuya_F3_Pro_UK_Date_Test.bin \
  Tuya_F3_Pro_v41_DimPagerSkip.bin
```

No third-party Python packages are required. The script verifies the input,
the compressed delta and the completed image before writing the output.

## Flash and read back

```bash
sunxi-fel spiflash-write 0 Tuya_F3_Pro_v41_DimPagerSkip.bin

sunxi-fel spiflash-read 0 0x800000 v41-readback.bin
stat -c '%s bytes' v41-readback.bin
sha256sum v41-readback.bin
```

Do not boot the panel until the readback is exactly 8,388,608 bytes and its
SHA-256 is:

```text
a23e4a6ea74cf490b45e8a96652ba50d11546bd8b54ef30d2bd9ed7b6a8599ed
```

## Known limitation inherited from the decoupling build

The current relay-decoupling implementation suppresses the complete settings
configuration reload. Changes made through the panel's Settings menu may not
persist after reboot. The decoupled button mappings themselves are present in
the generated v41 image.

## Why this is an offline patcher

The runtime wireless manifest format accepts at most 32 guarded word records.
The v35.6 curtain/page fix already consumed 31 records, before relay decoupling
and the v41 pager routine. The complete cumulative change therefore cannot be
represented safely as one current-format wireless manifest.
