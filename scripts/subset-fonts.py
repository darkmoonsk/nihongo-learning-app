"""Make local WOFF2 fonts from Google Fonts TTF sources (SIL OFL).

Install fonttools and brotli, then run this script from the repository root.
Pass an optional directory containing those tools as the first argument.
The Japanese subset covers kana, Japanese punctuation and the brand's kanji;
extend the set when adding vocabulary or kanji modules.
"""
import sys
from pathlib import Path

if len(sys.argv) > 1:
    sys.path.insert(0, sys.argv[1])

from fontTools import subset

fonts = Path("app/fonts")
specs = [
    ("PlusJakartaSans", list(range(0x20, 0x250)) + list(range(0x2000, 0x2070))),
    ("NotoSansJP", list(range(0x20, 0x7F)) + list(range(0x3000, 0x3100)) + [ord(c) for c in "日本語"]),
]
for name, unicodes in specs:
    options = subset.Options()
    options.flavor = "woff2"
    font = subset.load_font(str(fonts / f"{name}.ttf"), options)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    subset.save_font(font, str(fonts / f"{name}.woff2"), options)
    print(name, (fonts / f"{name}.woff2").stat().st_size, "bytes")
