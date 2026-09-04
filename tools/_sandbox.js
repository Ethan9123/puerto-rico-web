// ============================================================
// tools/_sandbox.js —— Node 侧共享的 vm 沙盒 + 最小 DOM shim
// ============================================================
// 背景：本项目无构建步骤，game.js / sim*.js 都是浏览器 <script> 直接加载的全局脚本。
// 以前 tests/*.js 与 tools/*.js 里有 40+ 份几乎相同的 makeEl()/sandbox 样板（各自缺一点
// shim，随 game.js 触碰新的浏览器 API 就集体崩）。本模块把它们收拢成一份「所有旧 shim 的超集」，
// 调用方只需：
//
//   const { loadEngine } = require('../tools/_sandbox.js');
//   const { sandbox, PRSim, load } = loadEngine({ files: ['ai_dna.js', 'game.js', 'sim.js'] });
//
// 或者更底层：
//
//   const { createSandbox } = require('../tools/_sandbox.js');
//   const { sandbox, load, run } = createSandbox({ beforeLoad: sb => { sb.Math = MathSeeded; } });
//   load('game.js'); ...
//
// API（详见各函数上方注释）：
//   createSandbox({ repoRoot, beforeLoad, extraGlobals, nodeRequire }) → { sandbox, load, run, repoRoot }
//   loadEngine({ files, ...createSandbox 选项 })                     → { sandbox, PRSim, load, run, repoRoot }
//   makeEl() / createStorage()                                        → 供需要自定义 shim 的调用方复用
//
// 设计要点：
//   * 与旧样板一致，Math/Date/JSON/Object/Array/... 等内建对象直接传宿主(host)的引用进沙盒，
//     这样 sandbox.Math 可在 game.js 加载前被整体替换成带种子的包装（eval_paired_worker 的复式赛制）。
//   * fetch(relPath) 只读本地文件：路径相对 repoRoot 解析（开头的 "/" 视为站点根 = repoRoot，
//     query/hash 会被剥掉）；文件不存在时返回 {ok:false,status:404} 而不是抛异常。
//   * 沙盒创建后返回的 sandbox 对象即 vm 上下文的全局对象，之后再给它赋属性（sandbox.X = ...）
//     在沙盒内立即可见，因此 beforeLoad 钩子 / 加载后注入旋钮都能直接写 sandbox。
//   * 零依赖，只用 Node 内建 fs / path / vm。
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

// 引擎默认加载顺序（与 index.html 中 <script> 顺序一致）
const DEFAULT_ENGINE_FILES = ['ai_dna.js', 'game.js', 'sim.js', 'sim_features.js', 'sim_nn.js', 'sim_az.js', 'sim_solve.js'];

// ---- 最小 DOM 元素 stub ----
// 所有方法都是 no-op / 返回空值；appendChild 会把子节点记进 _c 方便偶尔断言。
function makeEl(tag) {
  const el = {
    _c: [], tagName: String(tag || 'div').toUpperCase(), nodeType: 1,
    innerHTML: '', textContent: '', innerText: '', style: {}, className: '', id: '', dataset: {},
    value: '', checked: false, disabled: false, hidden: false, onclick: null,
    children: [], childNodes: [], firstChild: null, lastChild: null, parentNode: null, parentElement: null,
    offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, scrollTop: 0, scrollLeft: 0, scrollHeight: 0, scrollWidth: 0,
    classList: {
      _s: new Set(),
      add(...cs) { for (const c of cs) this._s.add(c); },
      remove(...cs) { for (const c of cs) this._s.delete(c); },
      toggle(c, force) { const on = force === undefined ? !this._s.has(c) : !!force; if (on) this._s.add(c); else this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this._c.push(c); return c; },
    removeChild(c) { const i = this._c.indexOf(c); if (i >= 0) this._c.splice(i, 1); return c; },
    insertBefore(c) { this._c.push(c); return c; },
    replaceChildren() { this._c.length = 0; }, append() {}, prepend() {}, before() {}, after() {},
    remove() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    insertAdjacentHTML() {}, insertAdjacentElement() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }; },
    getClientRects() { return []; },
    cloneNode() { return makeEl(tag); }, closest() { return null; }, matches() { return false; }, contains() { return false; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, scrollTo() {}, select() {},
  };
  return el;
}

// ---- 内存版 localStorage / sessionStorage ----
function createStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(String(k)) ? m.get(String(k)) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(String(k)); },
    key(i) { return i < m.size ? [...m.keys()][i] : null; },
    clear() { m.clear(); },
    get length() { return m.size; },
  };
}

// ---- 只读本地文件的 fetch shim ----
// fetch(url, init): url 去掉 query/hash、去掉开头 "/" 后相对 repoRoot 解析；
// 绝对文件系统路径（path.isAbsolute 且文件存在）也接受。
// 返回 { ok, status, url, headers, json(), text(), arrayBuffer() }；文件缺失 → ok:false, status:404。
function makeFetch(repoRoot) {
  return async function fetch(url, _init) {
    let u = String(url == null ? '' : (url && url.url) || url);
    const cut = u.search(/[?#]/); if (cut >= 0) u = u.slice(0, cut);
    let file = path.isAbsolute(u) && fs.existsSync(u) ? u : path.join(repoRoot, u.replace(/^\/+/, ''));
    let buf = null;
    try { buf = fs.readFileSync(file); } catch (e) { buf = null; }
    const ok = buf !== null;
    const headers = { get: () => null, has: () => false };
    if (!ok) {
      return { ok: false, status: 404, statusText: 'Not Found', url: u, headers,
        json: async () => { throw new Error('fetch shim: file not found: ' + file); },
        text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 200, statusText: 'OK', url: u, headers,
      json: async () => JSON.parse(buf.toString('utf8')),
      text: async () => buf.toString('utf8'),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

// ---- createSandbox ----
// opts:
//   repoRoot     : 仓库根目录（load/fetch 的相对路径基准），默认 tools/ 的上一级
//   beforeLoad   : function(sandbox) —— 上下文已创建、任何文件加载前调用；用于注入带种子的 Math、旋钮等
//   extraGlobals : {} —— 在 vm.createContext 之前合并进沙盒的额外全局（会覆盖同名默认 shim）
//   nodeRequire  : true 时把 Node 的 require 暴露进沙盒（默认不暴露，引擎文件不需要）
// 返回:
//   sandbox : 沙盒全局对象（== window == globalThis == self）
//   load(f) : 以 repoRoot 相对路径（或绝对路径）加载并执行脚本，返回脚本完成值
//   run(src, filename) : 在沙盒里执行一段源码字符串（相当于旧写法 vm.runInContext(src, sandbox)）
//   repoRoot
function createSandbox(opts = {}) {
  const repoRoot = opts.repoRoot || DEFAULT_REPO_ROOT;
  const _els = {};
  const documentStub = {
    getElementById: (id) => (_els[id] || (_els[id] = makeEl())),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => makeEl(t), createElementNS: (_ns, t) => makeEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    createDocumentFragment: () => makeEl('#fragment'),
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    activeElement: null, title: '', readyState: 'complete', visibilityState: 'visible', hidden: false,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  };
  const sandbox = {
    document: documentStub,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (h) => clearTimeout(h),
    performance: { now: () => Date.now() },
    // 内建对象：与旧样板一致直接传宿主引用（便于 beforeLoad 整体替换 Math 等）
    Math, Date, JSON, Object, Array, Set, Map, WeakMap, WeakSet, Number, String, Boolean, Promise, Symbol, RegExp,
    Error, TypeError, RangeError, isNaN, isFinite, parseInt, parseFloat, Infinity, NaN,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    Float32Array, Float64Array, Int32Array, Int16Array, Int8Array, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    ArrayBuffer, DataView, SharedArrayBuffer, Atomics,
    WebAssembly, // 宿主的 WebAssembly（沙盒内可直接实例化 wasm 内核）
    TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams, structuredClone,
    localStorage: createStorage(), sessionStorage: createStorage(),
    navigator: { sendBeacon: () => true, userAgent: 'node/' + process.version, hardwareConcurrency: 1, language: 'zh-CN', onLine: true },
    location: { search: '', origin: '', pathname: '/', protocol: 'http:', href: '', hash: '', host: '', hostname: '', reload() {}, replace() {} },
    fetch: makeFetch(repoRoot),
    module: { exports: {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, scrollTo() {},
  };
  if (opts.nodeRequire) sandbox.require = require;
  if (opts.extraGlobals) Object.assign(sandbox, opts.extraGlobals);
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  if (typeof opts.beforeLoad === 'function') opts.beforeLoad(sandbox);

  const load = (file) => {
    const full = path.isAbsolute(file) ? file : path.join(repoRoot, file);
    return vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: file });
  };
  const run = (src, filename) => vm.runInContext(src, sandbox, filename ? { filename } : undefined);
  return { sandbox, load, run, repoRoot };
}

// ---- loadEngine ----
// opts.files: 按顺序加载的文件列表，默认 DEFAULT_ENGINE_FILES；每项可为字符串，
//             或 { file, optional:true }（optional 且文件不存在时静默跳过）。
// 其余选项透传 createSandbox。返回 { sandbox, PRSim, load, run, repoRoot }。
function loadEngine(opts = {}) {
  const { files = DEFAULT_ENGINE_FILES, ...rest } = opts;
  const sb = createSandbox(rest);
  for (const it of files) {
    const file = typeof it === 'string' ? it : it.file;
    const optional = typeof it === 'object' && it && it.optional;
    const full = path.isAbsolute(file) ? file : path.join(sb.repoRoot, file);
    if (optional && !fs.existsSync(full)) continue;
    sb.load(file);
  }
  return { sandbox: sb.sandbox, PRSim: sb.sandbox.PRSim, load: sb.load, run: sb.run, repoRoot: sb.repoRoot };
}

module.exports = { createSandbox, loadEngine, makeEl, createStorage, makeFetch, DEFAULT_ENGINE_FILES };
