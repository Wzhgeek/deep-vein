#!/usr/bin/env bash
# =====================================================================
# 把《矿脉》打包成 macOS 应用（.app）
# 产物：build/矿脉.app —— 一个自包含的 WKWebView 壳 + 单文件游戏，约 1 MB
# 依赖：Xcode 命令行工具（swiftc / iconutil），macOS 自带
# 用法：bash packaging/macos/build.sh
# =====================================================================
set -euo pipefail
# 找一个可用的 node（DSH 的 shell 里 PATH 可能不含 /opt/homebrew/bin）
NODE="${NODE:-$(command -v node || true)}"
[ -z "$NODE" ] && for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
  [ -x "$c" ] && NODE="$c" && break
done
[ -z "$NODE" ] && { echo "找不到 node，请设置 NODE=/path/to/node"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/build"
APP="$BUILD/矿脉.app"
NAME="DeepVein"

echo "▸ 1/5 重新生成单文件游戏"
cd "$ROOT" && "$NODE" tools/build-version.js && "$NODE" tools/build-single.js

echo "▸ 2/5 组装 .app 目录结构"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "▸ 3/5 生成应用图标"
python3 "$HERE/make_icon.py" "$BUILD/raw" >/dev/null
python3 "$HERE/make_icns.py" "$BUILD/raw" "$APP/Contents/Resources/AppIcon.icns"

echo "▸ 4/5 编译 Swift 壳"
# 模块缓存默认写到 /var/folders（沙箱外），必须指到项目内
export CLANG_MODULE_CACHE_PATH="$BUILD/modcache"
export SWIFT_MODULE_CACHE_PATH="$BUILD/modcache"
mkdir -p "$BUILD/modcache"
swiftc -O -module-cache-path "$BUILD/modcache" "$HERE/main.swift" -o "$APP/Contents/MacOS/$NAME"

echo "▸ 5/5 放入游戏与 Info.plist"
cp "$ROOT/dist/矿脉.html" "$APP/Contents/Resources/deepvein.html"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>矿脉</string>
  <key>CFBundleDisplayName</key><string>矿脉 Deep Vein</string>
  <key>CFBundleExecutable</key><string>DeepVein</string>
  <key>CFBundleIdentifier</key><string>com.wzhgeek.deepvein</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT License</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "  （未签名：首次打开需右键→打开）"
echo
echo "✅ 完成：$APP"
du -sh "$APP" | awk '{print "   体积: "$1}'
