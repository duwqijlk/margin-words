#!/usr/bin/env python3
"""Write a card-sized JPEG of a cover to stdout. Long edge stays readable; width is at most 400px."""
import sys
from io import BytesIO

from PIL import Image

im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
if w > 400:
    im = im.resize((400, max(1, round(h * 400 / w))), Image.Resampling.LANCZOS)
buf = BytesIO()
im.save(buf, "JPEG", quality=82, optimize=True)
sys.stdout.buffer.write(buf.getvalue())
