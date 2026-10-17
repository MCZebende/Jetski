"""Recorta a carta KAP em tiles na resolução original, para o zoom não esticar uma miniatura."""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kap_to_png import decode_index, parse_header

FILL = {0, 2, 3, 4, 5, 6, 14, 15, 16, 18}


def world(lat, lon, zoom):
    size = 256 * (1 << zoom)
    x = (lon + 180.0) / 360.0 * size
    sine = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sine) / (1 - sine)) / (4 * math.pi)) * size
    return x, y


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "download/163601.KAP")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "charts/1636")
    preview = Path("charts/1636.png")
    if preview.exists():
        preview.unlink()
    data = src.read_bytes()
    meta = parse_header(data)
    index = np.frombuffer(decode_index(data, meta), dtype=np.uint8).reshape(meta["height"], meta["width"])
    palette = np.zeros((256, 4), dtype=np.uint8)
    for key, color in meta["rgb"].items():
        palette[int(key)] = (color[0], color[1], color[2], 255)
    is_ink = np.ones(256, dtype=bool)
    for fill in FILL:
        is_ink[fill] = False

    height, width = index.shape
    written = 0
    for zoom in range(11, 17):
        northwest_x, northwest_y = world(meta["north"], meta["west"], zoom)
        southeast_x, southeast_y = world(meta["south"], meta["east"], zoom)
        tile_x0 = int(math.floor(northwest_x / 256))
        tile_x1 = int(math.floor((southeast_x - 1e-6) / 256))
        tile_y0 = int(math.floor(northwest_y / 256))
        tile_y1 = int(math.floor((southeast_y - 1e-6) / 256))
        step = max(1, int(round((width - 1) / max(southeast_x - northwest_x, 1))))
        half = step // 2
        print(f"zoom {zoom}: {tile_x1 - tile_x0 + 1} x {tile_y1 - tile_y0 + 1} tiles, amostra {step}", flush=True)
        for tile_x in range(tile_x0, tile_x1 + 1):
            pixel_x = (tile_x * 256 + np.arange(256) + 0.5 - northwest_x) / (southeast_x - northwest_x) * (width - 1)
            column = np.clip(np.floor(pixel_x).astype(np.int32), 0, width - 1)
            inside_x = (pixel_x >= -0.5) & (pixel_x < width - 0.5)
            for tile_y in range(tile_y0, tile_y1 + 1):
                pixel_y = (tile_y * 256 + np.arange(256) + 0.5 - northwest_y) / (southeast_y - northwest_y) * (height - 1)
                row = np.clip(np.floor(pixel_y).astype(np.int32), 0, height - 1)
                inside = inside_x[None, :] & ((pixel_y >= -0.5) & (pixel_y < height - 0.5))[:, None]
                if not inside.any():
                    continue
                sample = index[row[:, None], column[None, :]]
                if step > 1:
                    inked = is_ink[sample]
                    for dy in range(-half, step - half):
                        yy = np.clip(row + dy, 0, height - 1)
                        for dx in range(-half, step - half):
                            if dx == 0 and dy == 0:
                                continue
                            xx = np.clip(column + dx, 0, width - 1)
                            pix = index[yy[:, None], xx[None, :]]
                            take = is_ink[pix] & ~inked
                            sample = np.where(take, pix, sample)
                            inked |= is_ink[pix]
                color = palette[sample]
                color[..., 3] = np.where(inside, 255, 0)
                if int(color[..., 3].max()) == 0:
                    continue
                folder = out / str(zoom) / str(tile_x)
                folder.mkdir(parents=True, exist_ok=True)
                Image.fromarray(color, "RGBA").save(folder / f"{tile_y}.png", compress_level=3)
                written += 1
    print(f"{written} tiles em {out}")


if __name__ == "__main__":
    main()
