/* ==========================================================================
 * content.js — Content Script
 * 职责：
 *   1. 在电商商品详情页右下角注入「获取图片」悬浮按钮
 *   2. 点击后扫描页面内所有商品图片（img / srcset / data-* / background-image / poster / 内联脚本）
 *   3. 过滤图标、logo、占位图、小图，补全绝对路径、去重
 *   4. 通过 chrome.runtime.sendMessage 把图片列表交给扩展
 *
 * 说明：本文件顶部的工具函数均为纯函数并挂载到 EImg，便于在 Node 中做单元测试。
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ========================================================================
   * 一、纯工具函数（无副作用，可在 Node 环境下测试）
   * ===================================================================== */

  /** 最低边长：小于该尺寸的图片视为缩略图/图标，直接过滤 */
  var MIN_SIZE = 100;

  /** 提取 http/https 图片地址 */
  function isHttpImageUrl(url) {
    return /^https?:\/\//i.test(url || '');
  }

  /** 相对路径 / 协议相对路径补全为绝对 URL；非法地址返回 null */
  function toAbsolute(url, base) {
    try {
      return new URL(url, base || 'https://example.com/').href;
    } catch (e) {
      return null;
    }
  }

  /**
   * 解析 srcset 字符串：
   *   "a.jpg 1x, b.jpg 2x" / "a.jpg 400w, b.jpg 800w" → 取每段的 URL 部分
   */
  function parseSrcset(srcset) {
    if (!srcset || typeof srcset !== 'string') return [];
    return srcset
      .split(',')
      .map(function (seg) { return seg.trim().split(/\s+/)[0]; })
      .filter(Boolean);
  }

  /** 从 background-image: url("...") 样式值中提取图片地址 */
  function parseBackgroundImage(value) {
    if (!value || value === 'none') return [];
    var out = [];
    var re = /url\((['"]?)(.*?)\1\)/gi;
    var m;
    while ((m = re.exec(value)) !== null) {
      if (m[2]) out.push(m[2]);
    }
    return out;
  }

  /**
   * URL 启发式过滤：图标 / logo / 雪碧图 / 占位图 / 1x1 像素图 / 加载动画
   * 各大平台 CDN 常见命名：sprite、logo、blank、spacer、loading、placeholder、1x1 等
   */
  var SKIP_URL_RE = /(sprite|\/icon|icons[\/._-]|logo|blank|spacer|placeholder|loading|transparent|1x1|pixel|\.gif([?#]|$))/i;
  function isSuspiciousUrl(url) {
    return SKIP_URL_RE.test(url || '');
  }

  /** 尺寸过滤：宽高已知的图片，任一边小于 MIN_SIZE 则丢弃 */
  function isTooSmall(width, height, min) {
    min = min || MIN_SIZE;
    if (!width || !height) return false; // 未知尺寸不过滤，交给启发式规则
    return width < min || height < min;
  }

  /** 去重归一化：去掉 hash 与常见缩放参数（淘宝 _x.jpg、京东 w/h 参数等） */
  function normalizeForDedupe(url) {
    try {
      var u = new URL(url);
      u.hash = '';
      ['_', 'x-oss-process', 'x-image-process'].forEach(function (k) { u.searchParams.delete(k); });
      return u.href;
    } catch (e) {
      return url;
    }
  }

  /** 按归一化地址去重，保留首次出现的条目 */
  function dedupe(items) {
    var seen = Object.create(null);
    return items.filter(function (it) {
      var key = normalizeForDedupe(it.url);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /**
   * 判断当前是否为「商品详情页」。
   * 平台差异说明：
   *   淘宝/天猫：/item.htm?id=xxxxx
   *   京东：item.jd.com/xxxxx.html 或 /product/xxxxx.html
   *   拼多多/商家版：/goods.html?goods_id=xxxxx
   */
  function isProductPage(loc) {
    var host = loc.hostname || '';
    var path = (loc.pathname || '') + (loc.search || '');
    if (/\.(taobao|tmall)\.com$/i.test(host)) {
      return /\/item\.htm/i.test(path) || /[?&]id=\d+/.test(path);
    }
    if (/\.jd\.com$/i.test(host)) {
      return /(^|\.)item\.jd\.com$/i.test(host) ||
             /\/product\/\d+/i.test(path) ||
             /\/\d+\.html?/i.test(loc.pathname || '');
    }
    if (/\.(pinduoduo|yangkeduo)\.com$/i.test(host)) {
      return /goods/i.test(path) || /[?&]goods_id=\d+/.test(path);
    }
    return false;
  }

  /**
   * 从 DOM 中收集候选图片地址。
   * @param {Document} doc       文档对象
   * @param {Function} getStyle  读取计算样式的函数（浏览器为 getComputedStyle，测试时可注入桩）
   */
  function collectFromDocument(doc, getStyle) {
    var candidates = []; // { url: string, width: number, height: number }

    function sizeOf(el) {
      // 仅 <img> 有 naturalWidth/Height；懒加载未触发时取不到尺寸（返回 0）
      var w = el.naturalWidth || 0;
      var h = el.naturalHeight || 0;
      return { w: w, h: h };
    }

    function push(url, el) {
      if (!url || typeof url !== 'string') return;
      var s = el ? sizeOf(el) : { w: 0, h: 0 };
      candidates.push({ url: url.trim(), width: s.w, height: s.h });
    }

    /* ---- 1. <img> 标签：src + 各平台懒加载属性（平台差异在此兼容） ---- */
    var LAZY_ATTRS = [
      'src',
      'data-src',            // 拼多多 / 通用
      'data-lazy-src',       // 京东部分页面
      'data-original',       // 老版本 jQuery 懒加载
      'data-url',            // 淘宝部分模块
      'data-ks-lazyload',    // 快手系 / 部分天猫模块
      'data-lazyload',       // 淘宝早期属性
      'data-img',            // 部分京东楼层
      'data-echo'            // echo.js 懒加载
    ];
    doc.querySelectorAll('img').forEach(function (img) {
      LAZY_ATTRS.forEach(function (attr) {
        var v = img.getAttribute(attr);
        if (v) push(v, img);
      });
      var ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      parseSrcset(ss).forEach(function (u) { push(u, img); });
    });

    /* ---- 2. <source> 标签（<picture> 响应式图源） ---- */
    doc.querySelectorAll('source').forEach(function (s) {
      parseSrcset(s.getAttribute('srcset')).forEach(function (u) { push(u, s); });
      var v = s.getAttribute('data-srcset');
      parseSrcset(v).forEach(function (u) { push(u, s); });
    });

    /* ---- 3. <video poster> 封面图 ---- */
    doc.querySelectorAll('video[poster]').forEach(function (v) {
      push(v.getAttribute('poster'), null);
    });

    /* ---- 4. 内联 background-image（swiper 轮播、div 背景商品图等） ---- */
    doc.querySelectorAll('div, span, li, a, section, figure, td, ul').forEach(function (el) {
      var bg = getStyle(el, 'background-image');
      parseBackgroundImage(bg).forEach(function (u) { push(u, null); });
    });

    return candidates;
  }

  /**
   * 内联脚本扫描：淘宝/京东/拼多多会把图片数据（如 imagePath、pic 数组）写在页面 JSON 里。
   * 这里用 CDN 域名 + 图片后缀的正则把地址捞出来，作为 DOM 提取的补充。
   */
  var SCRIPT_IMG_RE = /https?:\/\/[^"'<>\s\\]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s\\]*)?/gi;
  function scanInlineScripts(doc) {
    var out = [];
    doc.querySelectorAll('script:not([src])').forEach(function (s) {
      var text = s.textContent || '';
      var m = text.match(SCRIPT_IMG_RE);
      if (m) out = out.concat(m);
    });
    return out.map(function (u) { return { url: u, width: 0, height: 0 }; });
  }

  /**
   * 汇总并过滤出最终图片列表。
   * @returns Array<{ url: string, width: number, height: number }>
   */
  function buildImageList(doc, loc, getStyle) {
    var base = loc.origin || ('https://' + loc.hostname);
    var raw = collectFromDocument(doc, getStyle).concat(scanInlineScripts(doc));

    return dedupe(raw).filter(function (item) {
      var abs = toAbsolute(item.url, base);
      if (!abs || !isHttpImageUrl(abs)) return false;           // 过滤 data:/blob:/javascript: 等
      if (isSuspiciousUrl(abs)) return false;                   // 图标 / logo / 占位图
      if (isTooSmall(item.width, item.height, MIN_SIZE)) return false; // 小于 100x100
      item.url = abs;
      return true;
    });
  }

  /* 导出纯函数命名空间（浏览器中挂在 window，Node 测试中挂在 globalThis） */
  var EImg = {
    MIN_SIZE: MIN_SIZE,
    isHttpImageUrl: isHttpImageUrl,
    toAbsolute: toAbsolute,
    parseSrcset: parseSrcset,
    parseBackgroundImage: parseBackgroundImage,
    isSuspiciousUrl: isSuspiciousUrl,
    isTooSmall: isTooSmall,
    normalizeForDedupe: normalizeForDedupe,
    dedupe: dedupe,
    isProductPage: isProductPage,
    collectFromDocument: collectFromDocument,
    scanInlineScripts: scanInlineScripts,
    buildImageList: buildImageList
  };
  global.EImg = EImg;

  /* ========================================================================
   * 二、浏览器环境逻辑：注入按钮 + 提取 + 发送消息
   * ===================================================================== */
  if (typeof document === 'undefined' || typeof location === 'undefined') {
    return; // Node 测试环境，直接结束
  }

  var BTN_ID = 'eimg-fab-btn';
  var lastUrl = '';

  /** 显示一个轻提示气泡，2.5 秒后自动消失 */
  function showToast(text, isError) {
    var old = document.querySelector('.eimg-toast');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.className = 'eimg-toast' + (isError ? ' eimg-toast--error' : '');
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 2500);
  }

  /** 创建悬浮按钮 */
  function createButton() {
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'eimg-fab';
    btn.textContent = '获取图片';
    btn.addEventListener('click', onExtractClick);
    document.body.appendChild(btn);
  }

  /** 移除悬浮按钮 */
  function removeButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) btn.remove();
  }

  /** 点击「获取图片」：扫描 → 过滤 → 去重 → 发送给扩展 */
  function onExtractClick() {
    var btn = document.getElementById(BTN_ID);
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '提取中…';

    try {
      var images = buildImageList(document, location, function (el) {
        return global.getComputedStyle(el).backgroundImage || 'none';
      });

      if (!images.length) {
        showToast('未在页面中找到有效商品图片', true);
        btn.disabled = false;
        btn.textContent = '获取图片';
        return;
      }

      chrome.runtime.sendMessage(
        { type: 'EIMG_IMAGES', images: images },
        function (resp) {
          // 打开 gallery 页后 content script 可能被重建，忽略连接错误
          if (chrome.runtime.lastError) { /* no-op */ }
          if (resp && resp.ok) {
            showToast('已提取 ' + images.length + ' 张图片，正在打开预览…');
          }
          btn.disabled = false;
          btn.textContent = '获取图片';
        }
      );
    } catch (err) {
      showToast('提取失败：' + err.message, true);
      btn.disabled = false;
      btn.textContent = '获取图片';
    }
  }

  /**
   * SPA 页面适配：淘宝/京东/拼多多均为前端路由，
   * 用定时器轮询 URL 变化，在详情页注入按钮、离开详情页时移除。
   */
  function syncButton() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (isProductPage(location)) {
      if (!document.getElementById(BTN_ID)) createButton();
    } else {
      removeButton();
    }
  }

  function init() {
    if (!isProductPage(location)) return;
    lastUrl = location.href;
    createButton();
    setInterval(syncButton, 1500);
  }

  // 等 body 就绪后再注入按钮
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})(typeof window !== 'undefined' ? window : globalThis);
