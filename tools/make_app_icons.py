#!/usr/bin/env python3
# 一套图标，三处复用：macOS(.icns 素材) / Android(mipmap) / PWA(png)
# 图形直接用游戏自己的 8x8 像素素材，保证和应用内视觉一致。
import os, sys, importlib.util
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("mk", os.path.join(ROOT, 'packaging/macos/make_icon.py'))
mk = importlib.util.module_from_spec(spec); spec.loader.exec_module(mk)

ANDROID = {
    'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192,
}
PWA = {'icon-192.png': 192, 'icon-512.png': 512}

def main():
    # Android launcher icons
    for d, s in ANDROID.items():
        out = os.path.join(ROOT, 'packaging/android/app/src/main/res', 'mipmap-' + d)
        os.makedirs(out, exist_ok=True)
        mk.make(s, os.path.join(out, 'ic_launcher.png'))
    # PWA icons
    out = os.path.join(ROOT, 'assets/icons'); os.makedirs(out, exist_ok=True)
    for name, s in PWA.items():
        mk.make(s, os.path.join(out, name))
    print('✅ 图标已生成：Android %d 档 / PWA %d 个' % (len(ANDROID), len(PWA)))

if __name__ == '__main__':
    main()
