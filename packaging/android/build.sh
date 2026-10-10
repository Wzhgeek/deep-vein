#!/usr/bin/env bash
# =====================================================================
# 把《矿脉》打包成 Android APK
# 产物：packaging/android/app/build/outputs/apk/debug/app-debug.apk（约 1.5 MB）
# 依赖：Android SDK + JDK 17（Android Studio 自带），或直接用它打开本目录
# 用法：bash packaging/android/build.sh
# =====================================================================
set -euo pipefail
NODE="${NODE:-$(command -v node || true)}"
[ -z "$NODE" ] && for c in /opt/homebrew/bin/node /usr/local/bin/node; do [ -x "$c" ] && NODE="$c" && break; done
[ -z "$NODE" ] && { echo "找不到 node，请设置 NODE=/path/to/node"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"

echo "▸ 1/3 重新生成单文件游戏，并放进 assets/"
cd "$ROOT" && "$NODE" tools/build-single.js
mkdir -p "$HERE/app/src/main/assets"
cp "$ROOT/dist/矿脉.html" "$HERE/app/src/main/assets/deepvein.html"

echo "▸ 2/3 生成安卓图标"
cd "$ROOT" && python3 tools/make_app_icons.py

echo "▸ 3/3 构建 APK"
cd "$HERE"
if [ -x "./gradlew" ]; then
  ./gradlew assembleDebug
elif command -v gradle >/dev/null; then
  gradle assembleDebug
else
  cat <<'MSG'

⚠️ 本机没有 Android SDK / Gradle，APK 需要你在这台机器上装一次工具链，二选一：

  A. 图形界面（最省事）
     用 Android Studio 打开 packaging/android 目录，它会自动下载 Gradle 与 SDK，
     然后 Run ▶ 或 Build → Build APK(s)。

  B. 命令行
     1) 装 JDK 17 与 Android SDK（命令行工具即可）：https://developer.android.com/studio#command-tools
     2) export ANDROID_HOME=~/Library/Android/sdk
     3) brew install gradle && cd packaging/android && gradle assembleDebug

游戏本体已经就位（app/src/main/assets/deepvein.html），任何一步都能直接出包。
MSG
fi
