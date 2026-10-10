#!/usr/bin/env python3
# =====================================================================
# 矿脉 Deep Vein — 点阵字库生成器
# 用法: python3 tools/build_font.py
# 产出: src/pixfont.js  （1-bit 点阵字库 + 渲染器，零外部字体文件）
#
# 为什么要自己造：
#   真·像素中文字体（Zpix / 方舟像素）要么商用收费，要么下载不下来（本机 GitHub release 不可达）。
#   而"把系统字体光栅化到点阵网格"在 16px 这个经典尺寸上是完全可行的 —— 汉字在 16×16 网格里
#   本来就是点阵中文字体的黄金尺寸。12px 会糊（实测过），所以基准字号定 16。
# =====================================================================
import os, re, json, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
# 字库来源可配置：DV_FONT 指向任意 TTF/OTF/TTC，DV_FONT_INDEX 选 ttc 里的第几个字面。
#
# ⚠️ 授权提醒：默认用的是 macOS 自带字体，**本机使用没问题，但把从它光栅化出的位图
#    公开分发属于灰色地带**（Apple 的字体许可不允许再分发字体程序，位图是否算衍生有争议）。
#    要公开发布/商用，请换成 OFL 授权的字体重跑本脚本，例如：
#       curl -L -o tools/fonts/NotoSansSC-Regular.otf \
#         https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
#       DV_FONT=tools/fonts/NotoSansSC-Regular.otf python3 tools/build_font.py
FONT_PATH = os.environ.get("DV_FONT", "/System/Library/Fonts/STHeiti Light.ttc")
FONT_INDEX = int(os.environ.get("DV_FONT_INDEX", "0"))
CJK = 16      # 汉字基准字号（点阵中文字体的黄金尺寸）
SMALL = 8     # 拉丁/数字的小号，用于紧凑读数

def collect_chars():
    """扫描项目里所有会显示出来的字符（字符串字面量里的）"""
    chars = set()
    files = []
    for d in (SRC, ROOT):
        for f in os.listdir(d):
            if f.endswith(('.js', '.html')):
                files.append(os.path.join(d, f))
    for p in files:
        txt = open(p, encoding='utf-8').read()
        # 抓单引号/双引号/反引号里的内容
        for m in re.finditer(r"'([^'\\\n]*)'|\"([^\"\\\n]*)\"|`([^`]*)`", txt):
            for g in m.groups():
                if g:
                    for ch in g:
                        chars.add(ch)
    # 常用标点与符号补齐（界面里会拼出来的）
    chars |= set('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
                 ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
                 '　·—…、。！？：；（）【】《》“”‘’％＋－×÷≥≤→←↑↓★☆⚠✓✗')
    chars |= set('矿脉深晶尘空气下潜词条成就每日挑战赤铁苍铜蓝荧紫晶硫金')
    chars.discard('\n'); chars.discard('\t'); chars.discard('\r')
    return sorted(chars)

def is_cjk(ch):
    o = ord(ch)
    return (0x2E80 <= o <= 0x9FFF) or (0xF900 <= o <= 0xFAFF) or (0xFF00 <= o <= 0xFFEF) or (0x3000 <= o <= 0x303F)

def render(ch, size):
    """把一个字符渲染成 1-bit 点阵，返回 (bitmap_rows, advance)"""
    f = ImageFont.truetype(FONT_PATH, size, index=FONT_INDEX)
    pad = size
    img = Image.new("L", (size * 3 + pad, size * 3 + pad), 0)
    d = ImageDraw.Draw(img)
    d.text((pad, pad), ch, font=f, fill=255)
    bbox = img.getbbox()
    if bbox is None:
        return None, max(1, size // 3)     # 空格之类
    adv = d.textlength(ch, font=f)
    # 裁剪到网格内：汉字固定 size×size，拉丁按实际宽度
    # 关键：**竖直方向一律不裁剪**。所有字符都从同一个行盒顶部开始取 size 行，
    # 这样汉字与数字/拉丁的基线天然对齐（早期版本对拉丁裁了 ink bbox，结果数字整体上浮，
    # 和汉字混排时歪得很明显）。横向可以收紧左边距。
    w = size if is_cjk(ch) else max(1, min(size, int(round(adv))))
    h = size
    x0 = pad if is_cjk(ch) else bbox[0]
    y0 = pad
    crop = img.crop((x0, y0, x0 + w, y0 + h))
    b = crop.point(lambda v: 255 if v >= 120 else 0)
    rows = []
    px = b.load()
    for y in range(h):
        bits = 0
        for x in range(w):
            if px[x, y] > 0:
                bits |= (1 << x)
        rows.append(bits)
    return {'w': w, 'h': h, 'rows': rows, 'adv': int(round(adv))}, int(round(adv))

def hexrow(bits, w):
    """每行打包成十六进制（宽度<=16 位 -> 最多 4 个字符），比 '0101' 位串省 4 倍以上"""
    digits = (w + 3) // 4
    return format(bits, '0%dx' % digits)

def main():
    chars = collect_chars()
    cjk_glyphs, lat_glyphs, small_glyphs = {}, {}, {}
    missing = []
    for ch in chars:
        if ch == ' ' or ch == '\u3000':      # 半角与全角空格都是空白字形
            cjk_glyphs[ch] = {'w': 16 if ch == '\u3000' else 8, 'h': 1, 'rows': [0],
                              'adv': 16 if ch == '\u3000' else 8}
            if ch == ' ':
                small_glyphs[ch] = {'w': 4, 'h': 1, 'rows': [0], 'adv': 4}
            continue
        try:
            g, _ = render(ch, CJK)
            if g: cjk_glyphs[ch] = g
        except Exception:
            missing.append(('cjk', ch))
        if not is_cjk(ch):        # 小号表只放拉丁/数字/符号，汉字不需要两份
            try:
                g, _ = render(ch, SMALL)
                if g: small_glyphs[ch] = g
            except Exception:
                missing.append(('small', ch))

    def dump(d):
        out = []
        for ch in sorted(d.keys()):
            g = d[ch]
            rows = ','.join("'%s'" % hexrow(r, g['w']) for r in g['rows'])
            out.append("%s:[%d,%d,%d,[%s]]" % (json.dumps(ch, ensure_ascii=False), g['w'], g['h'], g['adv'], rows))
        return out

    js = []
    js.append("/* 自动生成，请勿手改 —— 见 tools/build_font.py */")
    js.append("'use strict';")
    js.append("(function(root){")
    js.append("// 格式: '字':[宽,高,步进,[每行比特串]]  1=亮 //")
    js.append("var C16={%s};" % ',\n'.join(dump(cjk_glyphs)))
    js.append("var S8={%s};" % ',\n'.join(dump(small_glyphs)))
    js.append(open(os.path.join(os.path.dirname(__file__), 'pixfont_runtime.js'), encoding='utf-8').read())
    js.append("})(typeof globalThis!=='undefined'?globalThis:this);")
    out = os.path.join(SRC, 'pixfont.js')
    open(out, 'w', encoding='utf-8').write('\n'.join(js))
    print('✓ 字库源: %s' % os.path.basename(FONT_PATH))
    print('✓ %s  16px 全字符表 %d 个 / 8px 小号表 %d 个  %.1f KB'
          % (os.path.relpath(out, ROOT), len(cjk_glyphs), len(small_glyphs), os.path.getsize(out) / 1024))
    if missing:
        print('  跳过:', missing[:8])

if __name__ == '__main__':
    main()
