# -*- coding: utf-8 -*-
"""生成扩展图标：圆角渐变方块 + 白色「图片下载」符号。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

PRIMARY = (79, 70, 229)    # #4f46e5
ACCENT = (124, 58, 237)    # #7c3aed
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 圆角矩形渐变底
    radius = int(size * 0.22)
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        gd.line([(0, y), (size, y)], fill=lerp(PRIMARY, ACCENT, y / size) + (255,))
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # 白色符号：太阳 + 山形（图片） + 向下箭头（下载）
    u = size / 128.0
    lw = max(2, int(7 * u))
    sun_r = int(10 * u)
    sun_c = (int(86 * u), int(36 * u))
    d.ellipse([sun_c[0] - sun_r, sun_c[1] - sun_r, sun_c[0] + sun_r, sun_c[1] + sun_r], fill=WHITE)
    d.line([(int(22 * u), int(76 * u)), (int(48 * u), int(48 * u)), (int(66 * u), int(68 * u)),
            (int(82 * u), int(54 * u)), (int(106 * u), int(76 * u))], fill=WHITE, width=lw, joint="curve")
    ax, ay = int(64 * u), int(92 * u)
    d.line([(ax, ay - 13 * u), (ax, ay + 9 * u)], fill=WHITE, width=lw)
    d.line([(ax - 9 * u, ay - 1 * u), (ax, ay + 11 * u), (ax + 9 * u, ay - 1 * u)], fill=WHITE, width=lw, joint="curve")
    d.line([(ax - 13 * u, ay + 17 * u), (ax + 13 * u, ay + 17 * u)], fill=WHITE, width=lw)

    return img


for s in (16, 32, 48, 128):
    make(s).save(os.path.join(OUT, f"icon{s}.png"))
    print(f"icons/icon{s}.png 生成完成")
