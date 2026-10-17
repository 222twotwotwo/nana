'use strict';
/**
 * agent-browser 调用封装。
 *
 * 关键坑：agent-browser 会拉起常驻 daemon，daemon 继承父进程 stdio 管道，
 * 于是 Node 的 execFileSync（stdio:'pipe'）永远等不到 EOF 而挂死；
 * PowerShell 里直接调用同一个 exe 也会挂住。
 * 解决：把子进程输出重定向到临时文件，而不是用管道捕获。
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-lib-'));

function resolveAgentBrowser() {
  if (process.env.AGENT_BROWSER_BIN) return process.env.AGENT_BROWSER_BIN;
  const candidates = [
    'D:/npm/global/node_modules/agent-browser/bin/agent-browser-win32-x64.exe',
    path.join(process.env.APPDATA || '', 'npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'),
    path.join(process.env.npm_config_prefix || '', 'node_modules/agent-browser/bin/agent-browser-win32-x64.exe')
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser';
}

const AGENT_BROWSER = resolveAgentBrowser();
let seq = 0;

/** 运行 agent-browser，返回 { status, stdout, stderr }；输出走临时文件 */
function run(args, { timeout = 120000 } = {}) {
  const tag = `r${seq++}`;
  const outFile = path.join(TMP, tag + '.out');
  const errFile = path.join(TMP, tag + '.err');
  const ofd = fs.openSync(outFile, 'w');
  const efd = fs.openSync(errFile, 'w');
  try {
    const r = spawnSync(AGENT_BROWSER, args, { stdio: ['ignore', ofd, efd], timeout, windowsHide: true });
    const stdout = fs.readFileSync(outFile, 'utf8');
    const stderr = fs.readFileSync(errFile, 'utf8');
    if (r.error) throw r.error;
    return { status: r.status, stdout, stderr };
  } finally {
    fs.closeSync(ofd); fs.closeSync(efd);
  }
}

function must(r, what) {
  if (r.status !== 0) throw new Error(`${what} 失败: ${(r.stderr || r.stdout).split('\n').filter(Boolean)[0] || 'exit ' + r.status}`);
  return r;
}

/** 依次执行多条 agent-browser 命令（单进程，减少启动开销） */
function batch(...cmds) {
  return must(run(['batch', '--bail', ...cmds]), 'batch').stdout;
}
/** 执行 JS 并返回其值（字符串形式，带引号） */
function evalJs(js) {
  return must(run(['eval', js]), 'eval').stdout.trim();
}

/**
 * 执行 JS 并把结果解析成 JS 值。
 * 注意：agent-browser 的 eval 返回的是**结果的 JSON 表示**——
 * 若被求值的表达式返回字符串，外层还会再套一层引号（如 `"{\"a\":1}"`），
 * 所以要先剥一层引号，再解析内层 JSON。
 */
function evalJson(js) {
  const raw = evalJs(js);
  let v;
  try { v = JSON.parse(raw); } catch { return raw; }
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}
/** 截图到指定路径 */
function shot(file) {
  return batch(`screenshot ${String(file).replace(/\\/g, '/')}`);
}
function open(url, { width = 1258, height = 622, settle = 3500 } = {}) {
  batch(`open ${url}`, `set viewport ${width} ${height}`);
  return sleep(settle);
}
function close() { try { run(['close'], { timeout: 60000 }); } catch { /* ignore */ } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 轮询等待一个 **JS 表达式** 变为真值。
 * 传 CSS 选择器时请写成 `document.querySelector('...')`，
 * 这样表达式（如 [...nodes].find(...)）与选择器可以统一处理。
 */
async function waitFor(expr, { timeout = 8000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  const probe = `!!(${expr})`;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      if (evalJs(probe) === 'true') return true;
    } catch (e) { lastErr = e.message; }
    await sleep(interval);
  }
  if (lastErr) throw new Error(`等待 ${expr} 超时（${lastErr.split('\n')[0]}）`);
  return false;
}

/**
 * 等待元素**可见**（已渲染且有尺寸）。
 *
 * 重要：App.vue 始终渲染全部页面，只是用 .hidden 切换，
 * 因此「元素存在」不等于「可点击」——隐藏页里的按钮 offsetParent 为 null，
 * CDP 真实点击会点空。凡是配合 `click` 使用的等待，都应该用这个而非 waitFor。
 */
async function waitVisible(selector, { timeout = 8000, interval = 200 } = {}) {
  const expr = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })()`;
  return waitFor(expr, { timeout, interval });
}

/**
 * 用真实鼠标事件点击（移动 → 按下 → 抬起）。
 *
 * 为什么不用 `batch('click <sel>')`：agent-browser 的 click 在部分元素上会命中
 * 容器而非目标（实测点分类按钮时事件 target 是外层 DIV，应用收不到点击），
 * 而合成 `element.click()` 又不授予 user activation，会被自动播放策略拦截。
 * 因此统一走「按元素中心坐标做真实鼠标操作」这条路：
 * 既拿到 user activation，又确保事件落在正确的元素上。
 */
async function clickMouse(selector) {
  if (!await waitVisible(selector)) throw new Error('元素不可见: ' + selector);
  const box = evalJson(`JSON.stringify((() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })())`);
  batch(`mouse move ${box.x} ${box.y}`, 'mouse down', 'mouse up');
}

/** 对表达式求值并点击其元素 */
function clickExpr(expr) {
  return evalJs(`((${expr})?.click(), 1)`);
}

module.exports = { AGENT_BROWSER, run, batch, evalJs, evalJson, shot, open, close, sleep, waitFor, waitVisible, clickMouse, clickExpr, TMP };
