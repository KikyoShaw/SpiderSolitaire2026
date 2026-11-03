"""Generate the bundled application icons using only the Python standard library."""
from pathlib import Path
import math
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2
SIZE = 256


def bezier(start, control_a, control_b, end):
    points = []
    for step in range(1, 25):
        t = step / 24
        u = 1 - t
        points.append((
            u ** 3 * start[0] + 3 * u * u * t * control_a[0]
            + 3 * u * t * t * control_b[0] + t ** 3 * end[0],
            u ** 3 * start[1] + 3 * u * u * t * control_a[1]
            + 3 * u * t * t * control_b[1] + t ** 3 * end[1],
        ))
    return points


def spade_path():
    points = [(128, 42)]
    for control_a, control_b, end in [
        ((112, 67), (66, 95), (62, 122)),
        ((55, 158), (89, 175), (118, 150)),
        ((116, 176), (104, 193), (88, 205)),
    ]:
        points.extend(bezier(points[-1], control_a, control_b, end))
    points.append((168, 205))
    for control_a, control_b, end in [
        ((152, 193), (140, 176), (138, 150)),
        ((167, 175), (201, 158), (194, 122)),
        ((190, 95), (144, 67), (128, 42)),
    ]:
        points.extend(bezier(points[-1], control_a, control_b, end))
    return points


def inside_polygon(x, y, polygon):
    inside = False
    previous = polygon[-1]
    for current in polygon:
        ax, ay = previous
        bx, by = current
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            inside = not inside
        previous = current
    return inside


def inside_round_rect(x, y, inset, radius):
    center_x = min(max(x, inset + radius), SIZE - inset - radius)
    center_y = min(max(y, inset + radius), SIZE - inset - radius)
    return (x - center_x) ** 2 + (y - center_y) ** 2 <= radius ** 2


def render():
    polygon = spade_path()
    pixels = []
    for py in range(SIZE * SCALE):
        row = []
        for px in range(SIZE * SCALE):
            x, y = (px + 0.5) / SCALE, (py + 0.5) / SCALE
            if not inside_round_rect(x, y, 5, 53):
                color = (0, 0, 0, 0)
            else:
                glow = max(0, 1 - math.hypot(x - 95, y - 75) / 260)
                color = (int(17 + glow * 16), int(56 + glow * 25), int(44 + glow * 17), 255)
                if inside_round_rect(x, y, 15, 44) and not inside_round_rect(x, y, 17, 42):
                    color = (142, 151, 104, 255)
                if 40 < x < 210 and 35 < y < 210 and inside_polygon(x, y, polygon):
                    shade = max(0, 1 - y / 360)
                    color = (int(215 + 29 * shade), int(184 + 34 * shade), int(112 + 41 * shade), 255)
            row.append(color)
        pixels.append(row)
    return pixels


def downsample(pixels, size):
    factor = len(pixels) // size
    output = bytearray()
    for y in range(size):
        output.append(0)
        for x in range(size):
            samples = [pixels[y * factor + dy][x * factor + dx]
                       for dy in range(factor) for dx in range(factor)]
            alpha_sum = sum(pixel[3] for pixel in samples)
            channels = [round(sum(pixel[channel] * pixel[3] for pixel in samples) / alpha_sum)
                        if alpha_sum else 0 for channel in range(3)]
            output.extend((*channels, round(alpha_sum / len(samples))))
    return bytes(output)


def png(pixels, size):
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xFFFFFFFF)
    header = struct.pack('!IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(downsample(pixels, size), 9)) + chunk(b'IEND', b'')


def main():
    target = ROOT / 'src-tauri' / 'icons'
    target.mkdir(parents=True, exist_ok=True)
    pixels = render()
    images = [(size, png(pixels, size)) for size in (32, 64, 128, 256)]
    for size, data in images:
        (target / f'{size}x{size}.png').write_bytes(data)
    (target / 'icon.png').write_bytes(images[-1][1])
    offset = 6 + len(images) * 16
    directory = bytearray(struct.pack('<HHH', 0, 1, len(images)))
    for size, data in images:
        directory.extend(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    (target / 'icon.ico').write_bytes(bytes(directory) + b''.join(data for _, data in images))
    print(f'Generated PNG and ICO assets in {target}')


if __name__ == '__main__':
    main()