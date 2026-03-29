/**
 * douyin-ops.js — 抖音操作高层 API
 *
 * 职责：
 *   基于 operator.js 的底层原子操作，编排抖音创作者平台的业务流程。
 *   全部通过 CDP 实现，不往页面注入任何对象。
 */
import { createOperator } from './operator.js';
import { sleep } from './util.js';
import config from './config.js';
import { existsSync } from 'node:fs';
import { resolve as pathResolve, normalize as pathNormalize } from 'node:path';

// ── 抖音创作者平台页面元素选择器 ──
const SELECTORS = {
  /** 左上角「高清发布」按钮 — 点击后进入上传页 */
  hdPublishBtn: [
    'button[class*="douyin-creator-master-button"]',
    '#douyin-creator-master-side-upload-wrap button',
    'button.header-button-KP2xn1',
  ],
  /** 标题输入框（标准 input） */
  titleInput: [
    'input[placeholder*="作品标题"]',
    'input.semi-input-default[placeholder*="标题"]',
    'input[placeholder*="标题"]',
  ],
  /** 作品简介（slate 富文本编辑器，contenteditable div） */
  descriptionInput: [
    'div[data-placeholder*="作品简介"][contenteditable="true"]',
    'div.editor-kit-container[contenteditable="true"]',
    'div[contenteditable="true"][data-slate-editor="true"]',
  ],
  /** 用户头像（登录状态指示） */
  userAvatar: [
    '[class*="avatar"]',
    'img[class*="avatar"]',
  ],
  /** 上传区域容器（包裹上传按钮和拖拽区） */
  uploadContainer: [
    'div[class*="drag-upload"]',
  ],
  /** 上传区域内的 file input（隐藏的，通过 CDP 直接设置文件） */
  uploadFileInput: [
    'div[class*="drag-upload"] input[type="file"]',
    'input[type="file"]',
  ],
  /** 「上传视频」按钮 — 发布视频 tab 下的入口 */
  uploadVideoBtn: [
    'div[class*="drag-upload"] button:has-text("上传视频")',
    'button[class*="container-drag-btn"]:has-text("上传视频")',
  ],
  /** 「上传图文」按钮 — 发布图文 tab 下的入口 */
  uploadImageTextBtn: [
    'div[class*="drag-upload"] button:has-text("上传图文")',
    'button[class*="container-drag-btn"]:has-text("上传图文")',
  ],
  /** 「我要发文」按钮 — 发布文章 tab 下的入口 */
  publishArticleBtn: [
    'div[class*="drag-upload"] button:has-text("我要发文")',
    'button[class*="container-drag-btn"]:has-text("我要发文")',
  ],
  /** 侧边栏导航 */
  sideNav: [
    'aside.sider-EdbKED',
    '[class*="sider"]',
    'aside',
  ],
  /** 发布类型 tab — 通用（匹配任意 tab 项） */
  publishTab: [
    'div[class*="tab-item"]',
  ],
  /** 发布类型 tab：发布视频 */
  tabVideo: [
    'div[class*="tab-item"]:has-text("发布视频")',
  ],
  /** 发布类型 tab：发布图文 */
  tabImageText: [
    'div[class*="tab-item"]:has-text("发布图文")',
  ],
  /** 发布类型 tab：发布文章 */
  tabArticle: [
    'div[class*="tab-item"]:has-text("发布文章")',
  ],
};

/**
 * 创建抖音操作实例
 * @param {import('puppeteer-core').Page} page
 */
export function createOps(page) {
  const op = createOperator(page);

  return {
    /** 暴露底层 operator */
    operator: op,

    /** 暴露选择器定义 */
    selectors: SELECTORS,

    /**
     * 探测页面各元素是否就位
     */
    async probe() {
      const [hdPublishBtn, titleInput, descriptionInput, userAvatar, sideNav, uploadContainer] = await Promise.all([
        op.locate(SELECTORS.hdPublishBtn),
        op.locate(SELECTORS.titleInput),
        op.locate(SELECTORS.descriptionInput),
        op.locate(SELECTORS.userAvatar),
        op.locate(SELECTORS.sideNav),
        op.locate(SELECTORS.uploadContainer),
      ]);

      const url = op.url();
      const isCreatorPage = url.includes('creator.douyin.com');

      return {
        hdPublishBtn: hdPublishBtn.found,
        titleInput: titleInput.found,
        descriptionInput: descriptionInput.found,
        userAvatar: userAvatar.found,
        sideNav: sideNav.found,
        uploadContainer: uploadContainer.found,
        currentUrl: url,
        isCreatorPage,
      };
    },

    /**
     * 切换到上传页
     *
     * 点击左上角「高清发布」按钮，页面切换到视频/图文上传界面。
     * 点击后等待页面导航完成（URL 变为 content/upload）。
     *
     * @param {object} [opts]
     * @param {number} [opts.timeout=15000] - 等待页面切换完成的超时
     * @returns {Promise<{ok: boolean, url?: string, elapsed?: number, error?: string}>}
     */
    async goUploadPage(opts = {}) {
      const { timeout = 15_000 } = opts;
      const start = Date.now();

      // 如果已经在上传页，直接返回
      const currentUrl = op.url();
      if (currentUrl.includes('content/upload')) {
        console.log('[ops] 已在上传页');
        return { ok: true, url: currentUrl, elapsed: 0, alreadyThere: true };
      }

      // 点击「高清发布」按钮
      const clickResult = await op.click(SELECTORS.hdPublishBtn);
      if (!clickResult.ok) {
        return { ok: false, error: 'hd_publish_btn_not_found', elapsed: Date.now() - start };
      }

      // 等待页面切换到上传页（URL 包含 content/upload）
      const waitResult = await op.waitFor(() => {
        return window.location.href.includes('content/upload');
      }, { timeout, interval: 500 });

      if (!waitResult.ok) {
        return { ok: false, error: 'upload_page_timeout', elapsed: Date.now() - start, currentUrl: op.url() };
      }

      await sleep(500); // 等 UI 稳定

      console.log('[ops] 已切换到上传页');
      return { ok: true, url: op.url(), elapsed: Date.now() - start };
    },

    /**
     * 切换发布类型（视频 / 图文 / 文章）
     *
     * 点击上传页顶部的 tab 切换发布类型。
     * 若当前 tab 已经是目标类型则跳过。
     *
     * @param {'video'|'imagetext'|'article'} type - 目标发布类型
     * @returns {Promise<{ok: boolean, type?: string, error?: string}>}
     */
    async switchPublishType(type) {
      const tabMap = {
        //  这里先暂时不支持全景视频，估计也没啥人发吧
        video:     { selectors: SELECTORS.tabVideo,     label: '发布视频' },
        imagetext: { selectors: SELECTORS.tabImageText, label: '发布图文' },
        article:   { selectors: SELECTORS.tabArticle,   label: '发布文章' },
      };

      const target = tabMap[type];
      if (!target) {
        return { ok: false, error: `unknown_type: ${type}，可选: video / imagetext / article` };
      }

      // 检查当前激活的 tab 是否已经是目标类型
      const isActive = await op.query((label) => {
        const tabs = [...document.querySelectorAll('div[class*="tab-item"]')];
        const target = tabs.find(t => t.textContent?.includes(label));
        if (!target) return false;
        return target.className.includes('active');
      }, target.label);

      if (isActive) {
        console.log(`[ops] 当前已在「${target.label}」tab`);
        return { ok: true, type, alreadyActive: true };
      }

      // 点击目标 tab
      const clickResult = await op.click(target.selectors);
      if (!clickResult.ok) {
        return { ok: false, error: `tab_not_found: ${target.label}` };
      }

      await sleep(250); // 等 UI 切换稳定

      console.log(`[ops] 已切换到「${target.label}」`);
      return { ok: true, type };
    },

    /**
     * 发布视频
     *
     * 前置条件：需在上传页 + 「发布视频」tab。
     * 会自动切换到发布视频 tab，然后通过 file input 上传视频文件。
     *
     * @param {string} filePath - 视频文件绝对路径
     * @param {object} [opts] - 发布选项（标题、描述等，待后续扩展）
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async publishVideo(filePath, opts = {}) {
      // 1. 确保在上传页
      const goResult = await this.goUploadPage();
      if (!goResult.ok) return goResult;

      // 2. 切换到发布视频 tab
      const switchResult = await this.switchPublishType('video');
      if (!switchResult.ok) return switchResult;

      await sleep(500);

      // 3. 点击「上传视频」按钮，同时拦截文件选择对话框
      const uploadResult = await this._clickAndChooseFile(SELECTORS.uploadVideoBtn, [filePath]);
      if (!uploadResult.ok) return uploadResult;

      // 4. 等待视频上传完成（uploading-container 消失）
      console.log('[ops] 视频文件已塞入，等待上传完成...');
      const uploadTimeout = opts.timeout || 300_000; // 默认 5 分钟
      const uploadStart = Date.now();

      await sleep(250); // 短暂等待 UI 开始上传

      while (Date.now() - uploadStart < uploadTimeout) {
        const uploading = await op.query(() => {
          return !!document.querySelector('[class*="uploading-container"]');
        });
        if (!uploading) break;
        await sleep(1000);
      }

      // 判断是否超时
      const elapsed = Date.now() - uploadStart;
      const stillUploading = await op.query(() => !!document.querySelector('[class*="uploading-container"]'));
      if (stillUploading) {
        return { ok: false, error: 'upload_timeout', detail: `视频上传超时 (${uploadTimeout}ms)`, file: filePath };
      }
      console.log(`[ops] 视频上传完成 (${elapsed}ms): ${filePath}`);

      // 5. 等待 AI 封面生成完毕，再选择推荐封面
      console.log('[ops] 等待 AI 封面生成完毕...');
      const coverReady = await op.waitFor(() => {
        const title = document.querySelector('span[class*="recommendTitle"]');
        if (!title) return false;
        // 文本变为"Ai智能推荐封面"（不含"生成中"）即为完成
        return title.textContent && !title.textContent.includes('生成中');
      }, { timeout: 60_000, interval: 1000 });

      if (!coverReady.ok) {
        console.warn(`[ops] AI 封面生成超时（60s），跳过封面选择`);
      }

      await sleep(250);
      const coverResult = await op.click(['div[class*="recommendCoverContainer"] > div:first-child']);
      if (coverResult.ok) {
        console.log('[ops] 已点击推荐封面，等待确认弹窗...');
        await sleep(250);
        const confirmResult = await op.click(['div.semi-modal-footer button.semi-button-primary']);
        if (confirmResult.ok) {
          console.log('[ops] 已确认封面选择');
        } else {
          console.warn('[ops] 未找到封面确认按钮，跳过');
        }
      } else {
        console.warn('[ops] 未找到推荐封面，跳过');
      }

      // 6. 填写标题
      const { title, description } = opts;
      if (title) {
        const titleResult = await this.fillTitle(title);
        if (!titleResult.ok) {
          console.warn(`[ops] 填写标题失败: ${titleResult.error}`);
        }
      }

      // 7. 填写作品简介
      if (description) {
        const descResult = await this.fillDescription(description);
        if (!descResult.ok) {
          console.warn(`[ops] 填写简介失败: ${descResult.error}`);
        }
      }

      // 8. 点击发布按钮（先滚动到视图内）
      await sleep(250);
      await op.query(() => {
        const container = document.querySelector('div[class*="card-container-creator-layout"]');
        const btn = container && [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === '发布');
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      await sleep(250);
      const publishLoc = await op.query(() => {
        const container = document.querySelector('div[class*="card-container-creator-layout"]');
        if (!container) return { found: false };
        const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === '发布');
        if (!btn) return { found: false };
        const rect = btn.getBoundingClientRect();
        return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      let publishResult = { ok: false };
      if (publishLoc.found) {
        await op.page.mouse.click(publishLoc.x, publishLoc.y);
        publishResult = { ok: true };
      }
      if (publishResult.ok) {
        console.log('[ops] 已点击发布按钮，检测发布结果...');
      } else {
        return { ok: false, error: 'publish_btn_not_found', file: filePath };
      }

      // 9. 检测 toast 判断发布结果
      const toastResult = await this._waitForToast();
      if (toastResult.found) {
        if (toastResult.success) {
          console.log('[ops] ✅ 视频发布成功');
          return { ok: true, type: 'video', file: filePath, elapsed, coverSelected: coverResult.ok };
        } else {
          console.error(`[ops] ❌ 视频发布失败: ${toastResult.text}`);
          return { ok: false, error: 'publish_failed', detail: toastResult.text, file: filePath };
        }
      }

      // 没检测到 toast，按成功处理（可能页面直接跳转了）
      return { ok: true, type: 'video', file: filePath, elapsed, coverSelected: coverResult.ok };
    },

    /**
     * 填写标题（标准 input 元素）
     * @param {string} title
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async fillTitle(title) {
      const loc = await op.locate(SELECTORS.titleInput);
      if (!loc.found) {
        return { ok: false, error: 'title_input_not_found' };
      }

      await op.click(SELECTORS.titleInput);
      await sleep(200);

      // Ctrl+A 全选清空，再输入新内容
      await op.page.keyboard.down('Control');
      await op.page.keyboard.press('a');
      await op.page.keyboard.up('Control');
      await op.type(title);

      console.log(`[ops] 已填写标题: ${title}`);
      return { ok: true };
    },

    /**
     * 填写作品简介（slate 富文本编辑器，contenteditable div）
     * @param {string} description
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async fillDescription(description) {
      const loc = await op.locate(SELECTORS.descriptionInput);
      if (!loc.found) {
        return { ok: false, error: 'description_input_not_found' };
      }

      // 点击聚焦 contenteditable 区域
      await op.click(SELECTORS.descriptionInput);
      await sleep(200);

      // Ctrl+A 全选清空，再通过 CDP insertText 输入（slate 编辑器最稳的方式）
      await op.page.keyboard.down('Control');
      await op.page.keyboard.press('a');
      await op.page.keyboard.up('Control');
      await op.type(description);

      console.log(`[ops] 已填写作品简介: ${description.slice(0, 30)}${description.length > 30 ? '...' : ''}`);
      return { ok: true };
    },

    /**
     * 发布图文
     *
     * 前置条件：需在上传页 + 「发布图文」tab。
     * 会自动切换到发布图文 tab，然后通过 file input 上传图片。
     *
     * @param {string|string[]} filePaths - 图片文件路径（单张或多张）
     * @param {object} [opts] - 发布选项（标题、描述等，待后续扩展）
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async publishImageText(filePaths, opts = {}) {
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths];

      // 1. 确保在上传页
      const goResult = await this.goUploadPage();
      if (!goResult.ok) return goResult;

      // 2. 切换到发布图文 tab
      const switchResult = await this.switchPublishType('imagetext');
      if (!switchResult.ok) return switchResult;

      await sleep(500);

      // 3. 点击「上传图文」按钮，同时拦截文件选择对话框
      const uploadResult = await this._clickAndChooseFile(SELECTORS.uploadImageTextBtn, paths);
      if (!uploadResult.ok) return uploadResult;

      console.log(`[ops] 图文已上传 ${paths.length} 张图片`);

      // 4. 填写标题
      const { title, description } = opts;
      if (title) {
        const titleResult = await this.fillTitle(title);
        if (!titleResult.ok) {
          console.warn(`[ops] 填写标题失败: ${titleResult.error}`);
        }
      }

      // 5. 填写作品简介
      if (description) {
        const descResult = await this.fillDescription(description);
        if (!descResult.ok) {
          console.warn(`[ops] 填写简介失败: ${descResult.error}`);
        }
      }

      // 6. 点击「选择音乐」（先滚动到视图中心）
      await sleep(500);
      await op.query(() => {
        const btn = [...document.querySelectorAll('span')].find(s => s.textContent?.includes('选择音乐'));
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      await sleep(500);
      const musicResult = await op.click([
        'div[class*="container-right"] span[class*="action"]:has-text("选择音乐")',
        'span[class*="action"]:has-text("选择音乐")',
      ]);
      if (musicResult.ok) {
        console.log('[ops] 已点击「选择音乐」');
      } else {
        console.warn('[ops] 未找到「选择音乐」按钮，跳过');
      }
      await sleep(500);

      // 5. 等待音乐收藏面板加载，hover 第一个 card，点击「使用」
      const musicPanelReady = await op.waitFor(() => {
        return !!document.querySelector('div[class*="music-collection-container"]');
      }, { timeout: 5000, interval: 500 });

      if (musicPanelReady.ok) {
        console.log('[ops] 音乐收藏面板已加载');
        await sleep(500);// 等待一小会

        // hover 第一个 card（触发「使用」按钮显示）
        const firstCard = await op.locate(['div[class*="music-collection-container"] div[class*="card-container"]:first-child']);
        if (firstCard.found) {
          await op.page.mouse.move(firstCard.x, firstCard.y);
          await sleep(500);

          // 点击「使用」按钮
          const useResult = await op.click([
            'div[class*="card-container"] button[class*="apply-btn"]',
            'div[class*="card-container-right"] button.semi-button-primary',
          ]);
          if (useResult.ok) {
            console.log('[ops] 已点击音乐「使用」按钮');
          } else {
            console.warn('[ops] 未找到音乐「使用」按钮');
          }
          await sleep(500);
        } else {
          console.warn('[ops] 未找到音乐卡片');
        }
      } else {
        console.warn('[ops] 音乐收藏面板未加载，跳过');
      }

      // 8. 点击发布按钮（先滚动到视图中心）
      await sleep(500);
      await op.query(() => {
        const container = document.querySelector('div[class*="card-container-creator-layout"]');
        const btn = container && [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === '发布');
        if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      await sleep(500);
      const publishLoc = await op.query(() => {
        const container = document.querySelector('div[class*="card-container-creator-layout"]');
        if (!container) return { found: false };
        const btn = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === '发布');
        if (!btn) return { found: false };
        const rect = btn.getBoundingClientRect();
        return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      let publishResult = { ok: false };
      if (publishLoc.found) {
        await op.page.mouse.click(publishLoc.x, publishLoc.y);
        publishResult = { ok: true };
      }
      if (publishResult.ok) {
        console.log('[ops] 已点击发布按钮，检测发布结果...');
      } else {
        return { ok: false, error: 'publish_btn_not_found', type: 'imagetext' };
      }

      // 9. 检测 toast 判断发布结果
      const toastResult = await this._waitForToast();
      if (toastResult.found) {
        if (toastResult.success) {
          console.log('[ops] ✅ 图文发布成功');
          return { ok: true, type: 'imagetext', count: paths.length, files: paths };
        } else {
          console.error(`[ops] ❌ 图文发布失败: ${toastResult.text}`);
          return { ok: false, error: 'publish_failed', detail: toastResult.text, type: 'imagetext' };
        }
      }

      return { ok: true, type: 'imagetext', count: paths.length, files: paths };
    },

    /**
     * 内部方法：等待 toast 提示出现，判断发布结果
     *
     * 点击发布按钮后，5 秒内每秒检测 semi-toast-content-text：
     *   - 文本包含"发布成功" → success
     *   - 其他文本 → 失败，返回 toast 内容
     *   - 超时无 toast → 未检测到
     *
     * @returns {Promise<{found: boolean, success?: boolean, text?: string}>}
     * @private
     */
    async _waitForToast() {
      for (let i = 0; i < 5; i++) {
        await sleep(1000);
        const toastText = await op.query(() => {
          const el = document.querySelector('span[class*="semi-toast-content-text"]');
          return el ? el.textContent?.trim() : null;
        });
        if (toastText) {
          console.log(`[ops] 检测到 toast: "${toastText}"`);
          return {
            found: true,
            success: toastText.includes('发布成功'),
            text: toastText,
          };
        }
      }
      console.log('[ops] 5 秒内未检测到 toast');
      return { found: false };
    },

    /**
     * 发布文章
     *
     * 前置条件：需在上传页 + 「发布文章」tab。
     * 会自动切换到发布文章 tab，然后点击「我要发文」进入编辑器。
     *
     * @param {object} [opts] - 发布选项（待后续扩展）
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async publishArticle(opts = {}) {
      // 1. 确保在上传页
      const goResult = await this.goUploadPage();
      if (!goResult.ok) return goResult;

      // 2. 切换到发布文章 tab
      const switchResult = await this.switchPublishType('article');
      if (!switchResult.ok) return switchResult;

      await sleep(500);

      // 3. 点击「我要发文」按钮进入文章编辑器
      const clickResult = await op.click([
        'button[class*="container-drag-btn"]:has-text("我要发文")',
        ...SELECTORS.publishArticleBtn,
      ]);
      if (!clickResult.ok) {
        return { ok: false, error: 'publish_article_btn_not_found' };
      }

      // 等待页面跳转到文章编辑器
      const navDone = await Promise.race([
        op.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 })
          .then(() => true)
          .catch(() => false),
        sleep(15_000).then(() => false),
      ]);

      if (!navDone) {
        console.warn('[ops] 文章编辑器页面未跳转，可能需要手动操作');
      }

      await sleep(1000); // 等待编辑器加载

      console.log('[ops] 已进入文章编辑器');
      return { ok: true, type: 'article' };
    },

    /**
     * 内部方法：点击按钮并通过 CDP 拦截文件选择对话框传入文件
     *
     * 参考 Gemini skill 的 uploadImage 实现：
     *   1. 路径规范化 + 文件存在性检查
     *   2. Promise.all 同时监听 fileChooser 和点击按钮
     *   3. fileChooser.accept() 直接传入文件，不弹出系统对话框
     *
     * @param {string[]} btnSelectors - 触发文件选择的按钮选择器
     * @param {string[]} filePaths - 要上传的文件绝对路径数组
     * @returns {Promise<{ok: boolean, error?: string}>}
     * @private
     */
    async _clickAndChooseFile(btnSelectors, filePaths) {
      try {
        // 1. 路径规范化 + 文件存在性检查
        const paths = filePaths.map(p => pathResolve(pathNormalize(p)));
        for (const p of paths) {
          if (!existsSync(p)) {
            return { ok: false, error: 'file_not_found', detail: `文件不存在: ${p}` };
          }
        }

        // 2. 同时监听 fileChooser 和点击按钮（必须并行，否则会错过事件）
        const [fileChooser] = await Promise.all([
          op.page.waitForFileChooser({ timeout: 5_000 }),
          op.click(btnSelectors),
        ]);

        // 3. 弹窗被拦截，直接塞入文件
        await fileChooser.accept(paths);
        console.log(`[ops] 文件已塞入 (${paths.length} 个)，等待处理...`);

        await sleep(1000);

        return { ok: true, count: paths.length };
      } catch (err) {
        return { ok: false, error: 'file_chooser_failed', detail: err.message };
      }
    },

    /**
     * 检查登录状态
     *
     * 判断逻辑（多级检测，适配多次调用的登录流程）：
     *   0. 如果传入了 smsCode，检测验证码输入框并填入提交
     *   1. 检测是否在二维码登录页
     *      → 有 aria-label="二维码" → 截图保存二维码，返回 phase='qrcode'
     *   2. 检测是否在身份验证界面（扫码后可能出现）
     *      → 有「接收短信验证码」元素 → 自动点击，返回 phase='sms_verification'
     *   3. 检测是否在验证码输入界面（已点击接收短信后出现）
     *      → 有验证码输入框 → 返回 phase='sms_code_input'，提示传入验证码
     *   4. 都没有 → 已登录，返回 phase='logged_in'
     *
     * MCP 客户端可多次调用此接口推进登录流程：
     *   第1次 → qrcode（用户去扫码）
     *   第2次 → sms_verification（自动点了接收验证码）
     *   第3次 → sms_code_input（提示需要传入验证码）
     *   第4次（带 smsCode）→ 填入验证码并提交
     *   第5次 → logged_in
     *
     * @param {object} [opts]
     * @param {string} [opts.smsCode] - 短信验证码（6位数字）
     * @returns {Promise<{ok: boolean, loggedIn: boolean, phase?: string, qrcodePath?: string}>}
     */
    async checkLogin(opts = {}) {
      const { smsCode } = opts;

      const SMS_CODE_INPUT = 'article[class*="uc_verification_component_layout"] #button-input[placeholder="请输入验证码"]';

      // ── 第1优先级：检测二维码登录页 ──
      const qrcodeInfo = await op.query(() => {
        const img = document.querySelector('img[aria-label="二维码"]');
        if (!img) return null;
        const rect = img.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });

      if (qrcodeInfo) {
        console.log('[ops] 检测到未登录（发现二维码），截取中...');
        try {
          const { mkdirSync, existsSync: exists } = await import('node:fs');
          const { join } = await import('node:path');

          const tempDir = join(config.outputDir, '..', 'temp');
          if (!exists(tempDir)) mkdirSync(tempDir, { recursive: true });

          const qrcodePath = join(tempDir, `qrcode_${Date.now()}.png`);
          await op.page.screenshot({
            path: qrcodePath,
            clip: {
              x: qrcodeInfo.x,
              y: qrcodeInfo.y,
              width: qrcodeInfo.width,
              height: qrcodeInfo.height,
            },
          });

          console.log(`[ops] 二维码已保存: ${qrcodePath}`);
          return { ok: true, loggedIn: false, phase: 'qrcode', qrcodePath };
        } catch (err) {
          console.warn(`[ops] 截图二维码失败: ${err.message}`);
        }

        return { ok: true, loggedIn: false, phase: 'qrcode' };
      }

      // ── 第2优先级：检测身份验证界面（扫码后的短信验证选择） ──
      const smsVerification = await op.query(() => {
        const els = document.querySelectorAll('div[class*="uc_verification_component"]');
        for (const el of els) {
          if (el.textContent?.includes('接收短信验证码')) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { found: true };
            }
          }
        }
        return { found: false };
      });

      if (smsVerification.found) {
        console.log('[ops] 检测到身份验证界面，自动点击「接收短信验证码」...');

        const clickResult = await op.click([
          'div[class*="uc_verification_component_list_item"]:has-text("接收短信验证码")',
          'div[class*="uc_verification_component"]:has-text("接收短信验证码")',
        ]);

        if (clickResult.ok) {
          console.log('[ops] 已点击「接收短信验证码」，等待验证码输入界面...');
          await sleep(1500);
        } else {
          console.warn('[ops] 找到验证界面但点击失败，可能需要手动操作');
        }

        return {
          ok: true,
          loggedIn: false,
          phase: 'sms_verification',
          clicked: clickResult.ok,
          message: clickResult.ok
            ? '已点击「接收短信验证码」，请查看手机短信，获取验证码后携带 smsCode 参数再次调用本接口'
            : '检测到身份验证界面但自动点击失败，请手动点击「接收短信验证码」后再次调用本接口',
        };
      }

      // ── 第3优先级：检测验证码输入框（已点击接收短信后的界面） ──
      const codeInput = await op.query((sel) => {
        const input = document.querySelector(sel);
        if (!input) return { found: false };
        const rect = input.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { found: true };
        }
        return { found: false };
      }, SMS_CODE_INPUT);

      if (codeInput.found) {
        // 没传验证码 → 提示用户
        if (!smsCode) {
          console.log('[ops] 检测到验证码输入框，等待用户提供验证码');
          return {
            ok: true,
            loggedIn: false,
            phase: 'sms_code_input',
            message: '已进入验证码输入界面，请获取手机短信验证码后，携带 smsCode 参数再次调用本接口',
          };
        }

        // 传了验证码 → 填入并提交
        console.log(`[ops] 收到验证码: ${smsCode}，填入中...`);

        await op.click([SMS_CODE_INPUT]);
        await sleep(300);

        await op.page.type(SMS_CODE_INPUT, smsCode, { delay: 100 });

        const inputValue = await op.query((sel) => {
          const input = document.querySelector(sel);
          return input ? input.value : '';
        }, SMS_CODE_INPUT);
        console.log(`[ops] 验证码填入结果: value="${inputValue}"`);

        await sleep(300);

        // 点击「验证」按钮
        const verifyBtnResult = await op.click([
          'div[class*="uc_verification_component_btn"][class*="primary"]:has-text("验证")',
          'div[class*="uc_verification_component_btn"]:has-text("验证")',
        ]);

        if (!verifyBtnResult.ok) {
          return {
            ok: true,
            loggedIn: false,
            phase: 'sms_code_submitted',
            message: '验证码已输入但未找到验证按钮，请手动点击验证按钮后再次调用本接口',
          };
        }

        console.log('[ops] 已点击验证按钮，等待页面跳转...');

        const navTimeout = 15_000;
        const verifyDone = await Promise.race([
          op.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: navTimeout })
            .then(() => 'navigated')
            .catch(() => null),
          op.waitFor((sel) => {
            return !document.querySelector(sel);
          }, { timeout: navTimeout, interval: 500, args: [SMS_CODE_INPUT] })
            .then(r => r.ok ? 'element_gone' : null),
        ]);

        if (!verifyDone) {
          return {
            ok: true,
            loggedIn: false,
            phase: 'sms_code_submitted',
            message: '验证码已输入，但页面尚未跳转。可能验证码有误或需要等待，请稍后再次调用本接口检测状态',
          };
        }

        console.log(`[ops] 验证页面已变化 (${verifyDone})，等待稳定...`);
        await sleep(1000);
        return { ok: true, loggedIn: true, phase: 'logged_in' };
      }

      // ── 第4优先级：都没有 → 已登录 ──
      return { ok: true, loggedIn: true, phase: 'logged_in' };
    },

    /**
     * 导航到指定的抖音页面
     * @param {string} url
     * @param {object} [opts]
     */
    async navigateTo(url, opts = {}) {
      const { timeout = 30_000 } = opts;

      // 安全检查：只允许抖音域名
      try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith('douyin.com')) {
          return { ok: false, error: 'invalid_domain', detail: `仅允许 douyin.com 域名，收到: ${parsed.hostname}` };
        }
      } catch {
        return { ok: false, error: 'invalid_url', detail: url };
      }

      const start = Date.now();
      try {
        await op.page.goto(url, { waitUntil: 'networkidle2', timeout });
        return { ok: true, url: op.url(), elapsed: Date.now() - start };
      } catch (err) {
        return { ok: false, error: 'navigation_failed', detail: err.message, elapsed: Date.now() - start };
      }
    },

    /**
     * 刷新页面
     */
    async reloadPage(opts = {}) {
      const { timeout = 30_000 } = opts;
      const start = Date.now();
      try {
        await op.page.reload({ waitUntil: 'networkidle2', timeout });
        return { ok: true, elapsed: Date.now() - start };
      } catch (err) {
        return { ok: false, error: 'reload_failed', detail: err.message, elapsed: Date.now() - start };
      }
    },

    /**
     * 发送文本消息并等待页面响应
     * 通用方法：向某个输入框填入文本并提交
     * @param {string} text
     * @param {object} [opts]
     */
    async fillAndSubmit(text, opts = {}) {
      const { inputSelectors = SELECTORS.descriptionInput, submitSelectors = SELECTORS.hdPublishBtn } = opts;

      const fillResult = await op.fill(inputSelectors, text);
      if (!fillResult.ok) {
        return { ok: false, error: 'fill_failed', detail: fillResult };
      }

      await sleep(300);

      const clickResult = await op.click(submitSelectors);
      if (!clickResult.ok) {
        return { ok: false, error: 'submit_click_failed', detail: clickResult };
      }

      return { ok: true };
    },

    /**
     * 截图（调试用）
     */
    async screenshot(opts = {}) {
      const { path, fullPage = true } = opts;
      return op.screenshot({ path, fullPage, type: 'png' });
    },
  };
}
