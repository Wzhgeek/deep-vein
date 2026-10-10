#!/usr/bin/env python3
# 生成 macOS 应用图标（直接复用游戏自己的 8x8 像素素材，保持品牌一致）
import re, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
art = open(os.path.join(ROOT, 'src/art.js'), encoding='utf-8').read()

def mask(name):
    m = re.search(r"^\s*%s:\s*\[(.*?)\]" % name, art, re.S | re.M)
    if not m:
        raise SystemExit('找不到位图 ' + name)
    rows = re.findall(r"'([^']*)'", m.group(1))
    return rows

PAL = {
    'red':    {1: '#ff9f87', 2: '#e05a3a', 3: '#a8331f', 4: '#4a1512'},
    'teal':   {1: '#9ff0d0', 2: '#35b58a', 3: '#1b7a63', 4: '#0d3a30'},
    'yellow': {1: '#ffe89a', 2: '#e0b83a', 3: '#a8841a', 4: '#4d3a0d'},
    'blue':   {1: '#a8d0ff', 2: '#4f7fe0', 3: '#2f4fa8', 4: '#141f4a'},
    'purple': {1: '#e0b0ff', 2: '#a666d6', 3: '#6f3aa0', 4: '#331a4d'},
}

def hex2rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

def draw_sprite(img, shape, pal, x, y, px):
    for r, row in enumerate(mask(shape)):
        for c, ch in enumerate(row[:8]):
            if ch in '1234':
                d = ImageDraw.Draw(img)
                col = hex2rgb(PAL[pal][int(ch)])
                d.rectangle([x + c * px, y + r * px, x + (c + 1) * px - 1, y + (r + 1) * px - 1], fill=col + (255,))

def make(size, path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角底：深色矿洞 + 从中心透出的暖光
    pad = int(size * 0.06)
    for i in range(24):                      # 伪径向渐变
        t = i / 23
        rr = int(size * 0.5 * (1 - t))
        a = int(90 * t * t)
        d.ellipse([size / 2 - rr, size / 2 - rr * 0.9, size / 2 + rr, size / 2 + rr * 0.9],
                  fill=(255, 200, 110, a))
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=int(size * 0.18),
                        outline=(107, 76, 46, 255), width=max(2, size // 90))
    # 三块矿石：一角大矿石 + 两颗小的，用游戏里的真实素材
    big = int(size * 0.42)
    px = max(1, big // 8)
    draw_sprite(img, 'round', 'red', int(size * 0.29), int(size * 0.24), px)
    s2 = int(size * 0.2)
    draw_sprite(img, 'diamond', 'blue', int(size * 0.14), int(size * 0.62), max(1, s2 // 8))
    draw_sprite(img, 'star', 'purple', int(size * 0.62), int(size * 0.6), max(1, s2 // 8))
    img.save(path)

if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for s in (16, 32, 64, 128, 256, 512, 1024):
        make(s, os.path.join(out, 'icon_%dx%d.png' % (s, s)))
    print('图标已生成 ->', out)
