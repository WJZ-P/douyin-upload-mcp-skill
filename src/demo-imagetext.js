/**
 * demo-imagetext.js — 抖音图文发布测试
 *
 * 直接修改下面的变量即可运行：
 *   node src/demo-imagetext.js
 */
import { createDouyinSession, disconnect } from './index.js';

// ── 修改这里 ──
const imagePaths = [
  './temp/qrcode_1774685463734.png',
  './temp/qrcode_1774690747355.png',
  './temp/qrcode_1774692780215.png',
];
const title = '图文测试标题';
const description = '图文测试简介';
const smsCode = '';  // 短信验证码（6位数字），需要时填入后重新运行

async function main() {
  console.log('=== 抖音图文发布 Demo ===\n');
  console.log(`图片: ${imagePaths.length} 张`);
  imagePaths.forEach((p, i) => console.log(`  [${i + 1}] ${p}`));
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

    // 3. 发布图文
    console.log('\n[3] 开始发布图文...');
    const start = Date.now();
    const result = await ops.publishImageText(imagePaths, { title, description });

    if (result.ok) {
      console.log(`\n✅ 图文发布成功！总耗时: ${Date.now() - start}ms`);
      console.log(`   图片数: ${result.count}`);
    } else {
      console.error(`\n❌ 图文发布失败: ${result.error}`);
      if (result.detail) console.error(`   详情: ${result.detail}`);
    }

  } catch (err) {
    console.error('Error:', err);
  }

  console.log('\n[done] Demo 完毕。');
  disconnect();
}

main().catch(console.error);
