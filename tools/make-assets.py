# assets/src/*.png (gpt-image-2 originals, ~2 MB each) -> app-sized copies: ui/img, ui/avatars, assets/app.ico
# usage: python tools/make-assets.py   (needs Pillow)
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
src, img, av = root / "assets/src", root / "ui/img", root / "ui/avatars"
img.mkdir(parents=True, exist_ok=True); av.mkdir(parents=True, exist_ok=True)

def save(im, path, size):
    im = im.convert("RGB")
    im.thumbnail(size, Image.LANCZOS)
    # flat vector art: 256-colour palette keeps it sharp at a fraction of the size
    im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
    print(path.relative_to(root), im.size, path.stat().st_size // 1024, "KB")

for p in sorted(src.glob("*.png")):
    im = Image.open(p)
    if p.stem == "logo":
        # the generated tile sits on black: cut the corners outside its rounded square to transparent
        logo = im.convert("RGBA")
        mask = Image.new("L", logo.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, logo.width - 1, logo.height - 1), radius=logo.width * 17 // 100, fill=255)
        logo.putalpha(mask)
        logo.resize((256, 256), Image.LANCZOS).save(img / "logo.png", optimize=True)
        logo.save(root / "assets/app.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
        print("ui/img/logo.png, assets/app.ico")
    elif p.stem == "hero":
        save(im, img / "hero.png", (1400, 1400))
    else:
        save(im, av / p.name, (192, 192))
