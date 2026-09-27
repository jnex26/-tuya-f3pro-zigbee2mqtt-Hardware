#!/usr/bin/env python3
"""Upgrade the supported Tuya F3-Pro UK-date image to hardware-proven v41."""

from __future__ import annotations

import argparse
import hashlib
import os
import tempfile
import zlib
from pathlib import Path


FLASH_SIZE = 0x800000
SUPPORTED_INPUT_SHA256 = (
    "4dd0f94097904134454ecf4270ac0908c41d0482d326f9073cada5f518dbe547"
)
DELTA_FILENAME = "f3pro_uk_date_to_v41.xor.zlib"
DELTA_SHA256 = (
    "d6db77ed964df33afc5671e4bc4d5cb164f41692332228e5a27f3ebf5970bd1c"
)
OUTPUT_SHA256 = (
    "a23e4a6ea74cf490b45e8a96652ba50d11546bd8b54ef30d2bd9ed7b6a8599ed"
)


class PatchError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Tuya_F3_Pro_UK_Date_Test.bin")
    parser.add_argument("output", type=Path, help="output v41 8 MiB image")
    parser.add_argument(
        "--delta",
        type=Path,
        default=Path(__file__).resolve().with_name(DELTA_FILENAME),
        help="override the bundled delta path",
    )
    parser.add_argument(
        "--force", action="store_true", help="replace an existing output file"
    )
    args = parser.parse_args()

    try:
        if args.output.exists() and not args.force:
            raise PatchError(f"output already exists: {args.output} (use --force)")
        if args.input.resolve() == args.output.resolve():
            raise PatchError("input and output must be different files")

        base = args.input.read_bytes()
        if len(base) != FLASH_SIZE:
            raise PatchError(
                f"input is {len(base)} bytes; expected {FLASH_SIZE} bytes"
            )
        input_hash = sha256(base)
        if input_hash != SUPPORTED_INPUT_SHA256:
            raise PatchError(
                "unsupported input image\n"
                f"  actual:   {input_hash}\n"
                f"  expected: {SUPPORTED_INPUT_SHA256}"
            )

        packed_delta = args.delta.read_bytes()
        delta_hash = sha256(packed_delta)
        if delta_hash != DELTA_SHA256:
            raise PatchError(
                "delta integrity check failed\n"
                f"  actual:   {delta_hash}\n"
                f"  expected: {DELTA_SHA256}"
            )
        try:
            delta = zlib.decompress(packed_delta)
        except zlib.error as error:
            raise PatchError(f"delta decompression failed: {error}") from error
        if len(delta) != FLASH_SIZE:
            raise PatchError(
                f"expanded delta is {len(delta)} bytes; expected {FLASH_SIZE} bytes"
            )

        output = bytes(a ^ b for a, b in zip(base, delta))
        output_hash = sha256(output)
        if output_hash != OUTPUT_SHA256:
            raise PatchError(
                "generated image verification failed\n"
                f"  actual:   {output_hash}\n"
                f"  expected: {OUTPUT_SHA256}"
            )

        args.output.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{args.output.name}.", dir=args.output.parent
        )
        try:
            with os.fdopen(descriptor, "wb") as temporary:
                temporary.write(output)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_name, args.output)
        except BaseException:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
            raise

        print(f"Created:  {args.output}")
        print(f"Size:     {len(output)} bytes (0x{len(output):x})")
        print(f"SHA-256:  {output_hash}")
        print("Target:   Tuya F3-Pro v41 DimPagerSkip (hardware validated)")
        return 0
    except (OSError, PatchError) as error:
        parser.exit(1, f"ERROR: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
