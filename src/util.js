/**
 * util.js — 公共工具函数
 */

/**
 * 异步等待指定毫秒数
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
