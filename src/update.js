/* =====================================================================
 * 矿脉 Deep Vein — 更新检查与提示
 *
 * 设计目标：**轻量、离线优先、三平台同一套代码**。
 *   · 网页 / PWA ：直接读同源的 ./version.json（顺带靠 Service Worker 处理"新版本待生效"）
 *   · macOS.app ：file:// 下读不到同源文件，改读 GitHub Pages 上的绝对地址
 *   · Android   ：同上（因此安卓壳需要 INTERNET 权限）
 *
 * 原则：**检查更新永远不能让游戏玩不了**。任何失败都静默忽略，
 * 超时 3 秒，结果只影响标题页要不要多显示一行字。
 * ===================================================================== */
'use strict';
(function (root) {

  // 版本清单的多个候选地址，按顺序试，第一个成功即用。
  // 不能只依赖 GitHub Pages：仓库没启用 Pages 时那个地址是 404，
  // 更新检查就会静默失效。jsDelivr 镜像 GitHub 仓库，是最稳的兜底。
  const ABSOLUTE_MANIFESTS = [
    'https://wzhgeek.github.io/deep-vein/version.json',
    'https://cdn.jsdelivr.net/gh/Wzhgeek/deep-vein@main/version.json',
    'https://raw.githubusercontent.com/Wzhgeek/deep-vein/main/version.json',
  ];
  const TIMEOUT_MS = 2500;

  /** "1.2.10" > "1.2.9"，按数字段比较（字符串比较会把 1.10 判小于 1.9） */
  function cmpVersion(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  const U = {
    get VERSION() { return root.VEIN_VERSION || '0.0.0'; },  // 由 tools/build-version.js 生成
    manifestUrl: ABSOLUTE_MANIFESTS[0],
    lastResult: null,          // { ok, latest, url, notes, error }
    _fetch: null,              // 测试可注入

    /** 按优先级给出所有可试的清单地址 */
    resolveUrls() {
      const proto = (root.location && root.location.protocol) || '';
      const out = [];
      if (proto === 'http:' || proto === 'https:') {
        out.push('version.json');          // 网页/PWA：同源相对路径最好，换托管也不用改
      }
      for (const u of ABSOLUTE_MANIFESTS) if (out.indexOf(u) < 0) out.push(u);
      return out;
    },

    /** 兼容旧接口：返回首选地址 */
    resolveUrl() { return U.resolveUrls()[0]; },

    /**
     * 检查更新。返回 Promise，永远是 resolve（不抛错）。
     * @param opts.force 用户手动点击时传 true —— 那种情况下失败要给出提示
     */
    /** 试一个地址 */
    _one(url) {
      const f = U._fetch || root.fetch;
      const ctl = root.AbortController ? new root.AbortController() : null;
      const timer = ctl ? root.setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
      // 加时间戳绕过缓存，否则可能一直读到旧的 version.json
      const bust = url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
      return f(bust, ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' })
        .then(r => { if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status)); return r.json(); })
        .then(j => {
          if (timer) root.clearTimeout(timer);
          if (!j || !j.version) throw new Error('清单格式不对');
          return j;
        })
        .catch(e => { if (timer) root.clearTimeout(timer); throw e; });
    },

    /**
     * 检查更新。逐个候选地址试，第一个成功就返回。
     * 返回 Promise，**永远 resolve**（失败只是一种结果，不是异常）。
     */
    check(opts) {
      opts = opts || {};
      const f = U._fetch || root.fetch;
      if (!f) { U.lastResult = { ok: false, error: 'no-fetch' }; return Promise.resolve(U.lastResult); }

      const urls = U.resolveUrls().slice(0, opts.maxSources || 3);
      let i = 0, lastErr = 'unknown';
      const attempt = () => {
        if (i >= urls.length) {
          U.lastResult = { ok: false, error: lastErr, tried: urls.length };
          return Promise.resolve(U.lastResult);
        }
        const url = urls[i++];
        return U._one(url).then(j => {
          const latest = String(j.version || '');
          U.lastResult = {
            ok: true, latest: latest, hasNew: cmpVersion(latest, U.VERSION) > 0,
            url: j.url || '', notes: j.notes || '', pages: j.pages || '', source: url
          };
          return U.lastResult;
        }).catch(e => {
          lastErr = (e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || e);
          return attempt();
        });
      };
      return attempt();
    },

    /** 在系统浏览器里打开链接。WebView 壳会拦截 window.open 并转交系统浏览器。 */
    open(url) {
      try {
        const w = root.open(url, '_blank', 'noopener');
        if (!w) root.location.href = url;      // 被拦截时退回当前窗口
      } catch (e) {
        try { root.location.href = url; } catch (e2) { }
      }
    }
  };

  root.VeinUpdate = U;
})(typeof globalThis !== 'undefined' ? globalThis : this);
