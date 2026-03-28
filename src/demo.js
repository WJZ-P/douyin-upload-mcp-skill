/**
 * demo.js — 抖音视频发布测试
 *
 * 直接修改下面的变量即可运行：
 *   node src/demo.js
 */
import { createDouyinSession, disconnect } from './index.js';
import { sleep } from './util.js';

// ── 修改这里 ──
const videoPath = './test/test.mp4';
const title = '测试标题';
const description = '测试简介';
const smsCode = '337676';  // 短信验证码（6位数字），需要时填入后重新运行

async function main() {
  console.log('=== 抖音视频发布 Demo ===\n');
  console.log(`视频: ${videoPath}`);
  console.log(`标题: ${title || '（不填）'}`);
  console.log(`简介: ${description || '（不填）'}`);
  console.log(`验证码: ${smsCode || '（未填）'}\n`);

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

    // 2. 检查登录（支持多阶段推进）
    console.log('\n[2] 检查登录状态...');
    const login = await ops.checkLogin({ smsCode: smsCode || undefined });
    console.log(`    phase: ${login.phase}`);
    if (login.message) console.log(`    ${login.message}`);
    if (login.qrcodePath) console.log(`    二维码: ${login.qrcodePath}`);

    if (!login.loggedIn) {
      console.log('\n⚠️  未完成登录，请根据提示操作后重新运行 demo。');
      if (login.phase === 'qrcode') {
        console.log('    → 请用抖音 App 扫码后重新运行');
      } else if (login.phase === 'sms_verification') {
        console.log('    → 已点击接收短信，请查看手机后将验证码填入 smsCode 变量重新运行');
      } else if (login.phase === 'sms_code_input') {
        console.log('    → 请将手机收到的验证码填入 smsCode 变量重新运行');
      } else if (login.phase === 'sms_code_submitted') {
        console.log('    → 验证码已提交，请稍等后重新运行');
      }
      disconnect();
      return;
    }

    console.log('    ✅ 已登录');

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
