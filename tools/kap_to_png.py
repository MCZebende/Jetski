"""Decodifica um raster KAP/BSB (leitura) para PNG georreferenciado.

O arquivo de saída fica no projeto para o mapa local. Não republica a carta.
"""
import json
import struct
import sys
import zlib
from pathlib import Path


def parse_header(data):
    end = data.find(b"\x1a\x00")
    if end < 0:
        raise SystemExit("Cabeçalho KAP sem terminador.")
    text = data[:end].decode("latin-1", errors="replace")
    lines = []
    current = ""
    for line in text.splitlines():
        if line.startswith(" ") or line.startswith("\t"):
            current += line.strip()
        else:
            if current:
                lines.append(current)
            current = line.strip()
    if current:
        lines.append(current)

    meta = {"rgb": {}, "ply": []}
    for line in lines:
        tag, _, rest = line.partition("/")
        if tag == "BSB" and "RA=" in rest:
            ra = rest.split("RA=", 1)[1]
            w, h = ra.split(",")[:2]
            meta["width"] = int(w)
            meta["height"] = int(h)
        if tag == "KNP":
            for part in rest.split(","):
                if "=" not in part:
                    continue
                key, val = part.split("=", 1)
                meta[key] = val
        if tag == "NTM":
            for part in rest.split(","):
                if part.startswith("NE="):
                    meta["aviso"] = part[3:]
        if tag == "RGB":
            num, r, g, b = rest.split(",")[:4]
            meta["rgb"][int(num)] = (int(r), int(g), int(b))
        if tag == "PLY":
            _n, lat, lon = rest.split(",")
            meta["ply"].append((float(lat), float(lon)))
    if "width" not in meta:
        raise SystemExit("BSB/RA ausente.")
    lats = [p[0] for p in meta["ply"]]
    lons = [p[1] for p in meta["ply"]]
    meta["south"] = min(lats)
    meta["north"] = max(lats)
    meta["west"] = min(lons)
    meta["east"] = max(lons)
    meta["data_at"] = end + 2
    return meta


def decode_index(data, meta):
    i = meta["data_at"]
    color_size = data[i]
    i += 1
    if not 1 <= color_size <= 7:
        raise SystemExit(f"Tamanho de cor inválido: {color_size}")
    shift = 7 - color_size
    value_mask = ((1 << color_size) - 1) << shift
    count_mask = (1 << shift) - 1
    width = meta["width"]
    height = meta["height"]
    index = bytearray(width * height)
    solid = {color: bytes([color]) * width for color in range(32)}
    n = len(data)

    def take():
        nonlocal i
        if i >= n:
            raise SystemExit("KAP terminou antes da imagem.")
        value = data[i]
        i += 1
        return value

    for row in range(height):
        marker = 0
        while True:
            token = take()
            marker = marker * 128 + (token & 0x7F)
            if not (token & 0x80):
                break
        if marker not in (row + 1, row):
            raise SystemExit(f"Linha {row} veio com número {marker}.")
        pixels = 0
        base = row * width
        while True:
            token = take()
            if token == 0:
                break
            color = (token & value_mask) >> shift
            run = token & count_mask
            while token & 0x80:
                token = take()
                run = run * 128 + (token & 0x7F)
            count = run + 1
            if pixels + count > width:
                count = width - pixels
            if count > 0:
                ink = solid[color]
                index[base + pixels:base + pixels + count] = ink[:count]
                pixels += count
        if pixels == width - 1:
            pixels = width
        if pixels != width:
            raise SystemExit(f"Linha {row} tem {pixels} pixels, esperado {width}.")
    return index


def decode(data, meta, step):
    i = meta["data_at"]
    color_size = data[i]
    i += 1
    if not 1 <= color_size <= 7:
        raise SystemExit(f"Tamanho de cor inválido: {color_size}")
    shift = 7 - color_size
    value_mask = ((1 << color_size) - 1) << shift
    count_mask = (1 << shift) - 1
    width = meta["width"]
    height = meta["height"]
    out_w = (width + step - 1) // step
    out_h = (height + step - 1) // step
    rgb = bytearray(out_w * out_h * 3)
    palette = meta["rgb"]
    n = len(data)

    def take():
        nonlocal i
        if i >= n:
            raise SystemExit("KAP terminou antes da imagem.")
        value = data[i]
        i += 1
        return value

    for row in range(height):
        marker = 0
        while True:
            token = take()
            marker = marker * 128 + (token & 0x7F)
            if not (token & 0x80):
                break
        if marker not in (row + 1, row):
            raise SystemExit(f"Linha {row} veio com número {marker}.")
        keep = row % step == 0
        y = row // step
        pixels = 0
        while True:
            token = take()
            if token == 0:
                break
            color = (token & value_mask) >> shift
            run = token & count_mask
            while token & 0x80:
                token = take()
                run = run * 128 + (token & 0x7F)
            count = run + 1
            if pixels + count > width:
                count = width - pixels
            if keep and count > 0:
                x0 = pixels
                x1 = pixels + count
                start = ((x0 + step - 1) // step) * step
                pos = y * out_w * 3
                ink = palette.get(color, (255, 0, 255))
                x = start
                while x < x1:
                    ox = x // step
                    if ox < out_w:
                        rgb[pos + ox * 3:pos + ox * 3 + 3] = bytes(ink)
                    x += step
            pixels += count
        if pixels == width - 1:
            pixels = width
        if pixels != width:
            raise SystemExit(f"Linha {row} tem {pixels} pixels, esperado {width}.")
    return rgb, out_w, out_h


def write_png(path, width, height, rgb):
    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    src = Path(sys.argv[1])
    step = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("charts") / (src.stem + ".png")
    data = src.read_bytes()
    meta = parse_header(data)
    rgb, width, height = decode(data, meta, step)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_png(out, width, height, rgb)
    side = {
        "id": "1636",
        "title": "Porto de Angra dos Reis e proximidades",
        "aviso": meta.get("aviso", ""),
        "scale": meta.get("SC", ""),
        "datum": meta.get("GD", ""),
        "south": meta["south"],
        "north": meta["north"],
        "west": meta["west"],
        "east": meta["east"],
        "url": "charts/" + out.name,
        "width": width,
        "height": height,
        "source": src.name
    }
    out.with_suffix(".json").write_text(json.dumps(side, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{out} {out.stat().st_size} bytes {width}x{height}")
    print(json.dumps({k: side[k] for k in ("south", "north", "west", "east", "aviso", "scale")}))


if __name__ == "__main__":
    main()
