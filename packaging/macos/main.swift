// 矿脉 Deep Vein — macOS 原生壳（WKWebView）
// 极简：一个窗口 + 一个 WebView 加载打包进来的单文件游戏。产物约 200 KB。
import Cocoa
import WebKit

let APP_W: CGFloat = 1066, APP_H: CGFloat = 600   // 游戏是 16:9，640x360 的 5/3 倍（非整数倍也清晰，因为画布用 CSS 缩放）

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ note: Notification) {
        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: APP_W, height: APP_H), configuration: cfg)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")     // 让底色由网页决定，避免白闪

        // 载入打包在 Resources 里的单文件游戏
        if let url = Bundle.main.url(forResource: "deepvein", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            web.loadHTMLString("<h1 style='color:#fff;font-family:sans-serif'>找不到 deepvein.html</h1>", baseURL: nil)
        }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: APP_W, height: APP_H),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "矿脉 Deep Vein"
        window.contentView = web
        window.minSize = NSSize(width: 640, height: 400)
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    /// 外部链接（例如"新版本可用"的下载页）交给系统默认浏览器打开。
    /// WKWebView 默认不处理 target=_blank，不拦这一手的话点了会毫无反应。
    func webView(_ webView: WKWebView, decidePolicyFor nav: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = nav.request.url, nav.navigationType == .linkActivated || url.scheme == "https" || url.scheme == "http" {
            if url.isFileURL { decisionHandler(.allow); return }
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
