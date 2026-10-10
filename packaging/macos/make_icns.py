#!/usr/bin/env python3
# 直接生成 .icns —— 不依赖 iconutil。
# ICNS 格式很简单：magic('icns') + 总长度，随后是若干块：类型(4) + 块长度(4) + 数据。
# 现代 macOS 接受 PNG 数据块，所以不需要转成老的位图格式。
import struct, sys, os

# 类型码 -> 对应像素尺寸（Apple 的 PNG 类型码）
TYPES = [
    (b'icp4', 16), (b'icp5', 32), (b'icp6', 64),
    (b'ic07', 128), (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024),
    (b'ic11', 32), (b'ic12', 64), (b'ic13', 256), (b'ic14', 512),
]

def build(raw_dir, out_path):
    chunks = b''
    for code, size in TYPES:
        p = os.path.join(raw_dir, 'icon_%dx%d.png' % (size, size))
        if not os.path.exists(p):
            continue
        data = open(p, 'rb').read()
        chunks += code + struct.pack('>I', len(data) + 8) + data
    icns = b'icns' + struct.pack('>I', len(chunks) + 8) + chunks
    open(out_path, 'wb').write(icns)
    return len(icns)

if __name__ == '__main__':
    n = build(sys.argv[1], sys.argv[2])
    print('ICNS 已生成: %s (%.1f KB, %d 个尺寸)' % (sys.argv[2], n / 1024, len(TYPES)))
