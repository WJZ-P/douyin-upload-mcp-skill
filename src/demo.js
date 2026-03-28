/**
 * demo.js — 抖音视频发布测试
 *
 * 直接修改下面的变量即可运行：
 *   node src/demo.js
 */
import { createDouyinSession, disconnect } from './index.js';

// ── 修改这里 ──
const videoPath = 'D:/videos/test.mp4';
const title = '测试标题';
const description = '测试简介';

async function main() {
  console.log('=== 抖音视频发布 Demo ===\n');
  console.log(`视频: ${videoPath}`);
  console.log(`标题: ${title || '（不填）'}`);
  console.log(`简介: ${description || '（不填）'}\n`);

  const { ops } = await createDouyinSession();

  // Ctrl+C 优雅退出
  process.on('SIGINT', () => {
    console.log('\n[demo] Ctrl+C，断开连接...');
    disconnect();
    process.exit(0);
  });

  try {
    // 1. 探测页面状态
    console.log('[1] 探测页面...');
    const probe = await ops.probe();
    console.log(`    创作者平台: ${probe.isCreatorPage ? '✅' : '❌'}  侧边栏: ${probe.sideNav ? '✅' : '❌'}`);

    // 2. 检查登录
    console.log('\n[2] 检查登录状态...');
    const login = await ops.checkLogin();
    console.log(`    ${login.loggedIn ? '✅ 已登录' : '❌ 未登录'}`);
    if (!login.loggedIn) {
      console.error('    请先在浏览器中登录抖音创作者平台！');
      disconnect();
      return;
    }

    // 3. 发布视频
    console.log('\n[3] 开始发布视频...');
    const start = Date.now();
    const result = await ops.publishVideo(videoPath, { title, description });

    if (result.ok) {
      console.log(`\n✅ 视频发布成功！总耗时: ${Date.now() - start}ms`);
      console.log(`   文件: ${result.file}`);
      console.log(`   上传耗时: ${result.elapsed}ms`);
      console.log(`   封面已选: ${result.coverSelected ? '是' : '否'}`);
    } else {
      console.error(`\n❌ 视频发布失败: ${result.error}`);
      if (result.detail) console.error(`   详情: ${result.detail}`);
    }

  } catch (err) {
    console.error('Error:', err);
  }

  console.log('\n[done] Demo 完毕。');
  disconnect();
}

main().catch(console.error);
