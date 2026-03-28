/**
 * operator.js — 纯 CDP 底层操作封装
 *
 * 职责：
 *   封装最基础的浏览器交互原语（点击、输入、查询、等待等），
 *   全部通过 CDP 协议实现，不往页面注入任何对象。
 *
 * 设计原则：
 *   - 所有 DOM 操作通过 page.evaluate() 一次性执行，执行完即走，不留痕迹
 *   - 鼠标 / 键盘事件通过 CDP Input 域发送，生成 isTrusted=true 的原生事件
 *   - 每个方法都是独立的原子操作，上层 douyin-ops.js 负责编排组合
 */
import { sleep } from './util.js';

/**
 * 创建 operator 实例
 * @param {import('puppeteer-core').Page} page
 */
export function createOperator(page) {

  // ─── 内部工具 ───

  /**
   * 通过 CSS 选择器列表查找第一个可见元素，返回其中心坐标和边界信息
   * @param {string[]} selectors
   * @returns {Promise<{found: boolean, x?: number, y?: number, width?: number, height?: number, selector?: string, tagName?: string}>}
   */
  async function locate(selectors) {
    return page.evaluate((sels) => {
      for (const sel of sels) {
        let el = null;
        try {
          // 支持 :has-text("xxx") 伪选择器
          if (sel.includes(':has-text(')) {
            const m = sel.match(/^(.*):has-text\("(.*)"\)$/);
            if (m) {
              const candidates = [...document.querySelectorAll(m[1] || '*')];
              el = candidates.find(n => {
                const r = n.getBoundingClientRect();
                const st = getComputedStyle(n);
                return r.width > 0 && r.height > 0
                  && st.display !== 'none' && st.visibility !== 'hidden'
                  && n.textContent?.includes(m[2]);
              }) || null;
            }
          } else {
            const all = [...document.querySelectorAll(sel)];
            el = all.find(n => {
              const r = n.getBoundingClientRect();
              const st = getComputedStyle(n);
              return r.width > 0 && r.height > 0
                && st.display !== 'none' && st.visibility !== 'hidden';
            }) || null;
          }
        } catch { /* 选择器语法错误，跳过 */ }

        if (el) {
          const rect = el.getBoundingClientRect();
          return {
            found: true,
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
            selector: sel,
            tagName: el.tagName.toLowerCase(),
          };
        }
      }
      return { found: false };
    }, selectors);
  }

  /**
   * 给坐标加一点随机偏移，模拟人类鼠标不精确的特征
   */
  function humanize(x, y, jitter = 3) {
    return {
      x: x + (Math.random() * 2 - 1) * jitter,
      y: y + (Math.random() * 2 - 1) * jitter,
    };
  }

  /**
   * 随机延迟（毫秒），模拟人类反应时间
   */
  function randomDelay(min, max) {
    const ms = min + Math.random() * (max - min);
    return sleep(ms);
  }

  // ─── 公开 API ───

  return {

    async locate(selectors) {
      const sels = Array.isArray(selectors) ? selectors : [selectors];
      return locate(sels);
    },

    async click(selectors, opts = {}) {
      const { jitter = 10, delayBeforeClick = 50, clickDuration = 80 } = opts;

      const sels = Array.isArray(selectors) ? selectors : [selectors];
      const loc = await locate(sels);
      if (!loc.found) {
        return { ok: false, error: 'element_not_found', triedSelectors: sels };
      }

      const { x, y } = humanize(loc.x, loc.y, jitter);

      await page.mouse.move(x, y);
      await randomDelay(delayBeforeClick * 0.5, delayBeforeClick * 1.5);

      await page.mouse.down();
      await randomDelay(clickDuration * 0.5, clickDuration * 1.5);
      await page.mouse.up();

      return { ok: true, selector: loc.selector, x, y };
    },

    async type(text, opts = {}) {
      const { mode = 'paste', minDelay = 30, maxDelay = 80 } = opts;

      if (mode === 'typeChar') {
        for (const char of text) {
          await page.keyboard.type(char);
          await randomDelay(minDelay, maxDelay);
        }
      } else {
        const client = page._client();
        await client.send('Input.insertText', { text });
      }

      return { ok: true, length: text.length, mode };
    },

    async fill(selectors, text) {
      const sels = Array.isArray(selectors) ? selectors : [selectors];
      const loc = await locate(sels);
      if (!loc.found) {
        return { ok: false, error: 'element_not_found', triedSelectors: sels };
      }

      const { x, y } = humanize(loc.x, loc.y, 2);
      await page.mouse.click(x, y);
      await randomDelay(100, 200);

      const result = await page.evaluate((selsInner, textInner) => {
        let el = null;
        for (const sel of selsInner) {
          try {
            const all = [...document.querySelectorAll(sel)];
            el = all.find(n => {
              const r = n.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            }) || null;
          } catch { /* skip */ }
          if (el) break;
        }

        if (!el) return { ok: false, error: 'element_lost_after_click' };

        el.focus();

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.value = textInner;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, textInner);
        }
        return { ok: true };
      }, sels, text);

      return { ...result, selector: loc.selector };
    },

    async query(fn, ...args) {
      return page.evaluate(fn, ...args);
    },

    async waitFor(conditionFn, opts = {}) {
      const { timeout = 30_000, interval = 500, args = [] } = opts;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        try {
          const result = await page.evaluate(conditionFn, ...args);
          if (result) {
            return { ok: true, result, elapsed: Date.now() - start };
          }
        } catch { /* 页面可能还在加载 */ }
        await sleep(interval);
      }

      return { ok: false, error: 'timeout', elapsed: Date.now() - start };
    },

    async waitForNavigation(opts = {}) {
      const { waitUntil = 'networkidle2', timeout = 30_000 } = opts;
      await page.waitForNavigation({ waitUntil, timeout });
    },

    async press(key, opts = {}) {
      const { delay = 50 } = opts;
      await page.keyboard.press(key, { delay });
      return { ok: true, key };
    },

    async screenshot(opts = {}) {
      return page.screenshot(opts);
    },

    url() {
      return page.url();
    },

    get page() {
      return page;
    },
  };
}
