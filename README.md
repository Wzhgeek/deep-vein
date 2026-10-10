# 矿脉 Deep Vein

> 像素风 · 消除 × 肉鸽 · 单机小游戏 —— **你消掉的不是方块，是空间。**

盘面是一整块矿脉，上方那条平巷是入口。**只有贴着矿道的矿石才能挖**，所以矿道的形状完全是你自己
挖出来的，每局长得都不一样。挖矿要花氧气，越深越肥，但氧气见底就是塌方 —— 本局结束。
什么时候升井，是这游戏唯一的重大决策。

![游戏画面](assets/hero.png)

## 立刻玩（都不需要联网）

| 方式 | 怎么做 | 大小 |
|---|---|---|
| **网页版**（最快） | 双击 `index.html` | 项目 1.1 MB |
| **单文件版**（方便分享） | 双击 `dist/矿脉.html` | 227 KB，一个文件装下整个游戏 |
| **macOS 应用** | `bash packaging/macos/build.sh` → 打开 `packaging/macos/build/矿脉.app` | **384 KB** |
| **Android 应用** | `bash packaging/android/build.sh`，或用 Android Studio 打开 `packaging/android/` | 约 1.5 MB |
| **PWA**（装到桌面/手机） | 部署到 GitHub Pages 后，浏览器菜单里「安装」/「添加到主屏幕」 | 0 |

热键：`1/2/3` 选词条 · `空格` 跳过三选一换晶尘 · `A` 升井结算 · `D` 每日挑战 · `T` 成就 · `S` 商店 ·
`H` 玩法 · `M` 静音 · `Esc` 返回

## 玩法一览

- **只有一个动词：点。** 同色相连 ≥2 块点一下整片挖掉；孤块和危险矿只能「开凿」（不费力气、不给进度，但能开路）。
- **矿道即地图。** 够不着的矿石画得很暗，能挖的画亮 —— 不用读说明就会自己发现规则。
- **六步新手教学**：首次下井会走一遍被聚光灯引导的首局。
- **40 条词条改写规则，不是数值**：共鸣、塌方连锁、熔炉、点石成金、深渊契约……
- **三种精英矿**（6 层起）：晶簇是补给点，深岩挖不动还会向下生长，毒气矿脉会不断污染矿石。
- **三条长期线**：词条研究（18/40 起步，其余用晶尘解锁）· 强化加深（7 项 18 级）· **深渊天梯（20 级）**。
- **每日挑战**：所有人当天玩到同一座矿（种子由日期派生，可以直接报给朋友比深度）。

## 目录

```
DeepVein/
├── index.html              直接打开就能玩
├── manifest.webmanifest    PWA 配置（可安装到桌面/手机）
├── sw.js                   Service Worker（离线可玩）
├── src/
│   ├── core.js             纯逻辑（零 DOM 依赖，可被 Node 直接跑）
│   ├── relics.js           40 条词条，数据驱动
│   ├── achievements.js     24 条成就
│   ├── pixfont.js          自研 16px 点阵字库（见下）
│   ├── art.js              自研 8×8 像素素材 + 程序化词条符文
│   ├── audio.js            WebAudio 实时合成音效（0 个音频文件）
│   └── app.js              渲染 / 交互 / UI / 元进程 / 存档
├── packaging/
│   ├── macos/              WKWebView 原生壳（swiftc 编译，384 KB）
│   └── android/            WebView 壳（Gradle 工程，约 1.5 MB）
├── tools/
│   ├── sim.js              单局平衡模拟 + 四条核心不变式断言
│   ├── meta-sim.js         元进程模拟：把长期目标买光要多少局
│   ├── browser-smoke.html  真浏览器 29 条断言（热区重叠/文字越界/缺字/死按钮…）
│   ├── build_font.py       从任意字体生成点阵字库
│   ├── build-single.js     打包成单个 HTML
│   ├── make_app_icons.py   一套图标三处复用（macOS/Android/PWA）
│   └── sheet.js            导出 PNG 精灵表
├── docs/
│   ├── 设计文档.md          规则、数值、40 条词条全表、实测数据、bug 复盘
│   └── 素材清单.md          可选素材库与授权避坑（含 Zpix 商用 ¥7000 的坑）
└── assets/                 导出的素材与截图
```

## 开发命令

```bash
node tools/sim.js 300          # 单局平衡 + 不变式验收（约 2 秒）
node tools/meta-sim.js 40      # 元进程模拟：长期目标要多少局买光
node tools/build-single.js     # 打包 dist/矿脉.html（单文件）
node tools/sheet.js            # 导出 assets/ores-sheet.png
python3 tools/build_font.py    # 重新生成点阵字库（见下）

bash packaging/macos/build.sh     # 构建 macOS .app
bash packaging/android/build.sh   # 构建 Android APK（需要 Android SDK）
```

浏览器断言（需要 Chrome）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --disable-gpu --no-sandbox --user-data-dir=/tmp/dv \
  --allow-file-access-from-files --dump-dom "file://$PWD/tools/browser-smoke.html"
```

## 发布与更新

### 一、首次上线

1. 推代码到 `main`（`ci.yml` 跑平衡模拟 + 浏览器断言 + 截图校验；`pages.yml` 把站点推到 `gh-pages` 分支）
2. **只需在设置里点一次**：仓库 **Settings → Pages → Build and deployment → Source =
   「Deploy from a branch」→ 分支选 `gh-pages` / 根目录**
   → 网页版上线在 `https://wzhgeek.github.io/deep-vein/`

> 这一步必须手动点一次：启用 Pages 属于仓库设置，工作流没有权限替你做
> （用 `actions/configure-pages` 的 `enablement` 也不行，实测仍失败）。
> **注意应用内的更新检查不依赖 Pages** —— 它按 `version.json` 的多个候选地址依次尝试，
> GitHub Pages 没启用时会自动回退到 jsDelivr 镜像。

### 二、发一个新版本

```bash
# 1. 改版本号与更新说明（应用内的"新版本可用"提示就是比这个文件）
#    version.json:  "version": "1.0.1"
#    CHANGELOG.md:  追加一节 "## [1.0.1] — 日期"
# 2. 提交并打标签
git add -A && git commit -m "release: v1.0.1"
git tag v1.0.1 && git push origin main --tags
```

推 tag 会触发 `release.yml`，自动：
- 用 `tools/screenshot.js` 生成 9 张游戏截图（带"非空白"校验，防止发出黑图）
- 构建 **DeepVein-single.html** / **DeepVein-macos.zip**（macOS runner 上 `swiftc` 编译）/ **DeepVein-android.apk**（ubuntu + Android SDK）
- 建 GitHub Release 并把三个产物挂上去

### 三、玩家怎么拿到更新

三条路径，**同一套代码**（`src/update.js`）：

| 平台 | 机制 |
|---|---|
| 网页 / PWA | Service Worker 检测到新版本 → 标题页出现「新版本已就绪 · 点这里刷新」（不自动刷新，免得毁掉正在打的一局） |
| macOS .app | 启动 1.2 秒后静默读 `version.json`，有新版则标题页出现「新版本 vX 可用 · 点这里更新」→ 用系统浏览器打开下载页 |
| Android APK | 同上。点提示后由 `WebViewClient` 转交系统浏览器打开 Release 页 |

版本清单按优先级依次尝试，**第一个成功即用**：

```
网页/PWA : version.json（同源）
.app/.apk: https://wzhgeek.github.io/deep-vein/version.json      ← Pages 启用后走这条
           https://cdn.jsdelivr.net/gh/Wzhgeek/deep-vein@main/version.json   ← 兜底，最稳
           https://raw.githubusercontent.com/Wzhgeek/deep-vein/main/version.json
```

设计原则：**检查更新永远不能让游戏玩不了** —— 3 秒超时、任何失败静默忽略、完全不联网也能正常玩。
（安卓壳因此加了 `INTERNET` 权限，但只用于这一次 GET。）

## 技术要点

- **零外部素材**：全部像素图是代码里的 8×8 位图，全部音效是 WebAudio 实时合成。
  40 条词条的徽记是用 id 哈希 + 镜像对称**程序化生成**的符文（已验证零碰撞）。
- **自研点阵字库**：正文统一 16px 点阵，由 `tools/build_font.py` 从字体光栅化成 1-bit 位图，
  运行时纯位运算绘制。**"正文最小 16px"是一条硬约束** —— 它把"一行能放多少字"物理限死，
  文案被迫变短，界面自然干净。
- **自动化验收**：单局/长线两个模拟器 + 真浏览器 29 条断言。多次靠它们抓出读代码看不出来的
  bug（矿道断裂、网格索引环绕、每层净赚氧气的永动机、一局 20 万晶尘……），
  完整复盘在 `docs/设计文档.md` §8.3。

## 授权

- **代码**：[MIT](LICENSE)。
- **点阵字库**：默认由 macOS 自带字体（STHeiti）光栅化而来。**本机使用没问题，但公开分发这些位图
  属于灰色地带**（Apple 的字体许可不允许再分发字体程序）。若要商用或想彻底干净，换成 OFL 字体重跑一次即可：

  ```bash
  curl -L -o tools/fonts/NotoSansSC-Regular.otf \
    https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf
  DV_FONT=tools/fonts/NotoSansSC-Regular.otf python3 tools/build_font.py
  ```

- **素材清单里提到的第三方素材**（Kenney / 0x72 等）**本项目一个都没有使用**，
  仅在文档里作为"后续升级时的可选素材菜单"列出，各自授权见 `docs/素材清单.md`。
