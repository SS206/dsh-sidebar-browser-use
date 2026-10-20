/**
 * dsh-browser-use-mcp - renderer (client) half.
 *
 * The host half cannot touch the sidebar webview: this half runs inside the
 * DSH main renderer, finds the visible Electron <webview>, executes page
 * scripts, and reports results back through the Connection RPC channel.
 */
window.__ModuleLoader__.load({
  id: 'dsh-browser-use-mcp',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const CHANNEL = '/browser-use';
    const POLL_INTERVAL_MS = 200;
    const HIDDEN_POLL_INTERVAL_MS = 1000;
    const NAVIGATION_TIMEOUT_MS = 25000;
    const BACKOFF_MS = [500, 1000, 2000, 5000];
    const MAX_IMAGE_BASE64_CHARS = 2_000_000;
    const WEBVIEW_SELECTOR = 'webview[data-sidebar-browser-frame="webview"]';

    exports.inject = ['connection'];

    //#region helpers

    function makeError(code, message, hint) {
      const error = new Error(message);
      error.code = code;
      if (hint !== undefined) error.hint = hint;
      return error;
    }

    function sleep(ms, signal) {
      return new Promise((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener('abort', done);
          resolve();
        }
        signal?.addEventListener('abort', done, { once: true });
      });
    }

    function visibleWebviews() {
      const all = [...document.querySelectorAll(WEBVIEW_SELECTOR)];
      return all.filter((element) => {
        if (!element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    }

    function pickWebview(tabId) {
      const candidates = visibleWebviews();
      if (tabId !== undefined && tabId !== null && tabId !== '') {
        const match = candidates.find((element) => element.getAttribute('name') === tabId);
        if (match === undefined) {
          throw makeError('NO_BROWSER_TAB', '找不到 lease id 为 ' + tabId + ' 的浏览器页面', '先调用 browser_tabs 查看当前页面');
        }
        return match;
      }
      if (candidates.length === 0) {
        throw makeError('NO_BROWSER_TAB', '右侧栏没有可见的浏览器页面', '请用户在右侧栏打开浏览器并输入 http/https 地址，或先调用 browser_open');
      }
      return candidates[0];
    }

    function describeWebview(element) {
      let url = '';
      let title = '';
      let loading = false;
      try {
        url = element.getURL();
      } catch {
        url = '';
      }
      try {
        title = element.getTitle();
      } catch {
        title = '';
      }
      try {
        loading = element.isLoading();
      } catch {
        loading = false;
      }
      return { id: element.getAttribute('name') ?? '', url, title, loading, visible: true };
    }

    function waitForLoad(element, timeoutMs) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          element.removeEventListener('did-stop-loading', onStop);
          element.removeEventListener('did-fail-load', onFail);
        };
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn(value);
        };
        const onStop = () => finish(resolve);
        const onFail = (event) => {
          const description = event?.errorDescription ?? event?.errorCode ?? 'unknown';
          if (String(description).includes('ERR_ABORTED')) return finish(resolve);
          finish(reject, makeError('NAVIGATION_BLOCKED', '页面加载失败：' + String(description)));
        };
        timer = setTimeout(() => finish(reject, makeError('TIMEOUT', '等待页面加载超时（' + timeoutMs + 'ms）')), timeoutMs);
        element.addEventListener('did-stop-loading', onStop);
        element.addEventListener('did-fail-load', onFail);
        if (!element.isLoading()) finish(resolve);
      });
    }

    async function navigate(element, url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw makeError('NAVIGATION_BLOCKED', 'url 不是合法地址：' + url);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw makeError('NAVIGATION_BLOCKED', '只允许 http/https 地址');
      }
      if (parsed.username !== '' || parsed.password !== '') {
        throw makeError('NAVIGATION_BLOCKED', '不允许带内嵌凭据的 URL');
      }
      await element.loadURL(parsed.href);
      await waitForLoad(element, NAVIGATION_TIMEOUT_MS);
      return describeWebview(element);
    }

    /** Run one self-contained page function inside the webview guest. */
    async function runPageFunction(element, fn, ...args) {
      const code = '(' + fn.toString() + ')(' + args.map((value) => JSON.stringify(value)).join(', ') + ')';
      return await element.executeJavaScript(code);
    }

    //#endregion

    //#region page-side functions (serialized with toString, no outer references)

    function pageSnapshot(maxNodes, selector) {
      const refs = new Map();
      window.__dshBrowserUseRefs = refs;
      const result = { url: location.href, title: document.title, nodes: [], text: '', truncated: false };
      const root = selector ? document.querySelector(selector) : document.body;
      if (!root) {
        result.error = 'selector not found: ' + selector;
        return result;
      }
      const candidates = [root, ...root.querySelectorAll('a,button,input,textarea,select,option,[role],[tabindex],[contenteditable],h1,h2,h3,h4,h5,h6,img,label,summary')];
      const seen = new Set();
      for (const element of candidates) {
        if (result.nodes.length >= maxNodes) {
          result.truncated = true;
          break;
        }
        if (seen.has(element)) continue;
        seen.add(element);
        if (element.closest('script,style,template,noscript')) continue;
        if (element.getAttribute('aria-hidden') === 'true') continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute('role') || tag;
        const rawName = element.getAttribute('aria-label')
          || element.getAttribute('placeholder')
          || element.getAttribute('alt')
          || element.getAttribute('title')
          || (element.innerText || '').trim()
          || element.value
          || '';
        const ref = 'e' + (refs.size + 1);
        refs.set(ref, element);
        const node = { ref, tag, role, name: String(rawName).slice(0, 160) };
        if (tag === 'a' && element.href) node.href = String(element.href).slice(0, 300);
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          node.type = element.type || tag;
          if (element.type === 'password') node.value = '•••';
          else if (typeof element.value === 'string') node.value = element.value.slice(0, 120);
        }
        if (element.disabled === true) node.disabled = true;
        result.nodes.push(node);
      }
      result.text = (document.body?.innerText || '').slice(0, 3000);
      return result;
    }

    function pageClick(ref) {
      const refs = window.__dshBrowserUseRefs;
      const element = refs instanceof Map ? refs.get(ref) : undefined;
      if (!element || !element.isConnected) return { ok: false, code: 'NO_SUCH_REF' };
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.click();
      return { ok: true };
    }

    function pageFill(ref, text, submit) {
      const refs = window.__dshBrowserUseRefs;
      const element = refs instanceof Map ? refs.get(ref) : undefined;
      if (!element || !element.isConnected) return { ok: false, code: 'NO_SUCH_REF' };
      element.focus();
      const isTextarea = element instanceof HTMLTextAreaElement;
      const prototype = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter !== undefined) setter.call(element, text);
      else element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      if (submit === true) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
      }
      return { ok: true };
    }

    function pagePress(key, ref) {
      const refs = window.__dshBrowserUseRefs;
      let element = ref ? (refs instanceof Map ? refs.get(ref) : undefined) : document.activeElement;
      if (ref && (!element || !element.isConnected)) return { ok: false, code: 'NO_SUCH_REF' };
      if (!element) element = document.body;
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
      return { ok: true };
    }

    //#endregion

    //#region command execution

    async function executeCommand(ctx, command) {
      const op = command.op;
      const args = command.args !== null && typeof command.args === 'object' ? command.args : {};
      switch (op) {
        case 'browser_tabs': {
          const tabs = visibleWebviews().map(describeWebview);
          if (tabs.length === 0) {
            throw makeError('NO_BROWSER_TAB', '右侧栏没有可见的浏览器页面', '请用户在右侧栏打开浏览器并输入 http/https 地址');
          }
          return { text: JSON.stringify(tabs, null, 2) };
        }
        case 'browser_snapshot': {
          const element = pickWebview(args.tab);
          const maxNodes = Number.isInteger(args.maxNodes) ? args.maxNodes : 250;
          const selector = typeof args.selector === 'string' && args.selector !== '' ? args.selector : null;
          const snapshot = await runPageFunction(element, pageSnapshot, maxNodes, selector);
          if (snapshot?.error !== undefined) throw makeError('CLIENT_ERROR', String(snapshot.error));
          return { text: JSON.stringify(snapshot, null, 2) };
        }
        case 'browser_text': {
          const element = pickWebview(args.tab);
          const maxChars = Number.isInteger(args.maxChars) ? args.maxChars : 3000;
          const text = await element.executeJavaScript('String(document.body?.innerText ?? "").slice(0, ' + maxChars + ')');
          return { text: typeof text === 'string' ? text : String(text) };
        }
        case 'browser_screenshot': {
          const element = pickWebview(args.tab);
          let image = await element.capturePage();
          const size = image.getSize();
          if (size.width > 1600 || size.height > 1200) {
            const scale = Math.min(1600 / size.width, 1200 / size.height);
            image = image.resize({ width: Math.max(1, Math.round(size.width * scale)) });
          }
          const dataUrl = image.toDataURL();
          const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
          if (base64.length > MAX_IMAGE_BASE64_CHARS) {
            throw makeError('CLIENT_ERROR', '截图过大（' + base64.length + ' 字符 base64），已拒绝返回', '改用 browser_snapshot，或缩小窗口后再截图');
          }
          return {
            text: '已截取侧栏浏览器页面（' + image.getSize().width + 'x' + image.getSize().height + '）',
            image: { data: base64, mimeType: 'image/png' },
          };
        }
        case 'browser_navigate': {
          const element = pickWebview(args.tab);
          const info = await navigate(element, String(args.url));
          return { text: '已导航到 ' + info.url + (info.title ? '（' + info.title + '）' : '') };
        }
        case 'browser_click': {
          const element = pickWebview(args.tab);
          const result = await runPageFunction(element, pageClick, String(args.ref));
          if (result?.ok !== true) throw makeError('NO_SUCH_REF', 'ref ' + args.ref + ' 不在最近一次 snapshot 中', '重新调用 browser_snapshot 获取最新 ref');
          return { text: '已点击 ' + args.ref };
        }
        case 'browser_fill': {
          const element = pickWebview(args.tab);
          const result = await runPageFunction(element, pageFill, String(args.ref), String(args.text ?? ''), args.submit === true);
          if (result?.ok !== true) throw makeError('NO_SUCH_REF', 'ref ' + args.ref + ' 不在最近一次 snapshot 中', '重新调用 browser_snapshot 获取最新 ref');
          return { text: '已填写 ' + args.ref + (args.submit === true ? ' 并提交' : '') };
        }
        case 'browser_press': {
          const element = pickWebview(args.tab);
          const result = await runPageFunction(element, pagePress, String(args.key), typeof args.ref === 'string' ? args.ref : null);
          if (result?.ok !== true) throw makeError('NO_SUCH_REF', 'ref ' + args.ref + ' 不在最近一次 snapshot 中');
          return { text: '已按下 ' + args.key };
        }
        case 'browser_history': {
          const element = pickWebview(args.tab);
          const direction = String(args.direction);
          if (direction === 'back') {
            if (element.canGoBack() !== true) throw makeError('CLIENT_ERROR', '没有可后退的历史');
            await element.goBack();
          } else if (direction === 'forward') {
            if (element.canGoForward() !== true) throw makeError('CLIENT_ERROR', '没有可前进的历史');
            await element.goForward();
          } else if (direction === 'reload') {
            await element.reload();
          }
          else throw makeError('CLIENT_ERROR', 'direction 必须是 back/forward/reload');
          await waitForLoad(element, NAVIGATION_TIMEOUT_MS);
          const info = describeWebview(element);
          return { text: '已执行 ' + direction + '：' + info.url };
        }
        case 'browser_open': {
          const sidebarRight = ctx.get?.('sidebarRight') ?? ctx.sidebarRight;
          if (!sidebarRight || typeof sidebarRight.openTab !== 'function') {
            throw makeError('CLIENT_ERROR', '当前界面不支持从插件新开浏览器页');
          }
          const url = String(args.url);
          let parsed;
          try {
            parsed = new URL(url);
          } catch {
            throw makeError('NAVIGATION_BLOCKED', 'url 不是合法地址：' + url);
          }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw makeError('NAVIGATION_BLOCKED', '只允许 http/https 地址');
          }
          if (parsed.username !== '' || parsed.password !== '') {
            throw makeError('NAVIGATION_BLOCKED', '不允许带内嵌凭据的 URL');
          }
          sidebarRight.openTab('browser', { params: { url: parsed.href } });
          return { text: '已请求在右侧栏打开 ' + parsed.href + '；稍后用 browser_tabs 确认' };
        }
        case 'browser_eval': {
          const element = pickWebview(args.tab);
          const value = await element.executeJavaScript(String(args.script));
          let encoded;
          try {
            encoded = JSON.stringify(value);
          } catch {
            encoded = String(value);
          }
          return { text: encoded === undefined ? 'undefined' : encoded };
        }
        default:
          throw makeError('CLIENT_ERROR', '未知浏览器操作：' + String(op));
      }
    }

    //#endregion

    //#region poll loop

    function currentSessionId(ctx) {
      try {
        const mounted = ctx.sidebarRight?.mounted;
        const snapshot = typeof mounted?.getSnapshot === 'function' ? mounted.getSnapshot() : mounted;
        return snapshot?.id;
      } catch {
        return undefined;
      }
    }

    /** POST one request to the host renderer route (same-origin through dsh-app). */
    async function requestHost(payload, signal) {
      const response = await fetch('/api/browser-use', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      let body;
      try {
        body = await response.json();
      } catch {
        throw makeError('CLIENT_ERROR', 'browser bridge returned a non-JSON response (HTTP ' + response.status + ')');
      }
      if (body === null || typeof body !== 'object' || body.ok !== true) {
        const error = body !== null && typeof body === 'object' && body.error !== undefined ? body.error : undefined;
        throw makeError(
          typeof error?.code === 'string' ? error.code : 'CLIENT_ERROR',
          typeof error?.message === 'string' ? error.message : 'browser bridge request failed (HTTP ' + response.status + ')',
          typeof error?.hint === 'string' ? error.hint : undefined,
        );
      }
      return body.value;
    }

    async function loop(ctx, signal) {
      const clientId = 'renderer-' + Math.random().toString(36).slice(2, 10);
      let backoff = 0;
      while (!signal.aborted) {
        let commands = [];
        try {
          const value = await requestHost({
            op: 'poll',
            clientId,
            sessionId: currentSessionId(ctx),
            capacity: 4,
          }, signal);
          commands = value?.commands ?? [];
          backoff = 0;
        } catch (error) {
          if (signal.aborted) break;
          const delay = BACKOFF_MS[Math.min(backoff, BACKOFF_MS.length - 1)];
          backoff += 1;
          await sleep(delay, signal);
          continue;
        }
        for (const command of commands) {
          if (signal.aborted) break;
          let payload;
          try {
            const value = await executeCommand(ctx, command);
            payload = { clientId, id: command.id, ok: true, value };
          } catch (error) {
            payload = {
              clientId,
              id: command.id,
              ok: false,
              error: {
                code: typeof error?.code === 'string' ? error.code : 'CLIENT_ERROR',
                message: error instanceof Error ? error.message : String(error),
                ...typeof error?.hint === 'string' ? { hint: error.hint } : {},
              },
            };
          }
          try {
            await requestHost({ op: 'result', ...payload }, signal);
          } catch {
            /* the host parks its own timeout; a failed result upload is not fatal */
          }
        }
        const hidden = document.visibilityState === 'hidden';
        await sleep(hidden ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS, signal);
      }
    }

    //#endregion

    function apply(ctx) {
      const abort = new AbortController();
      ctx.effect(() => {
        void loop(ctx, abort.signal);
        return () => abort.abort();
      }, 'browser-use-mcp: poll loop');
    }

    exports.apply = apply;
    return module.exports;
  },
});
