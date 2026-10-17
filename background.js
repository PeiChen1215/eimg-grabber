/* ==========================================================================
 * background.js — MV3 Service Worker
 * 职责：
 *   1. 接收 content.js 提取到的图片列表 → 暂存 storage.session → 打开 gallery.html
 *   2. 处理「抓取远程图片并转 PNG」请求（gallery 页面跨域失败时的兜底通道）
 *   3. 点击扩展图标时，直接打开最近一次的图片画廊
 * ========================================================================== */

/** 存储键名前缀：每张来源标签页对应一份图片列表 */
var STORAGE_PREFIX = 'eimg_list_';

/** 清理 30 分钟以前的过期数据，避免 session 存储堆积 */
function cleanupExpired() {
  var deadline = Date.now() - 30 * 60 * 1000;
  chrome.storage.session.get(null, function (all) {
    if (chrome.runtime.lastError || !all) return;
    var expired = Object.keys(all).filter(function (k) {
      return k.indexOf(STORAGE_PREFIX) === 0 && all[k] && all[k].time < deadline;
    });
    if (expired.length) chrome.storage.session.remove(expired);
  });
}

/**
 * 在 Service Worker 中抓取远程图片并转为 PNG dataURL。
 * 说明：host_permissions 已声明三大平台域名，同源/平台 CDN 图片可直接抓取；
 * 部分公共 CDN（如 alicdn）返回 Access-Control-Allow-Origin: * 时也能成功。
 * @param {string} url 图片地址
 * @returns {Promise<string>} PNG 的 dataURL
 */
async function fetchAndConvertToPng(url) {
  var resp = await fetch(url, { credentials: 'include', cache: 'force-cache' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);

  var blob = await resp.blob();
  var bitmap = await createImageBitmap(blob);

  var canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  var ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  var pngBlob = await canvas.convertToBlob({ type: 'image/png' });
  return blobToDataURL(pngBlob);
}

/** Blob → dataURL（Service Worker 无 FileReader 依赖时的通用实现） */
function blobToDataURL(blob) {
  return new Promise(function (resolve, reject) {
    if (typeof FileReader !== 'undefined') {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
      return;
    }
    // 兜底：手动 base64（FileReader 不可用时）
    blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var binary = '';
      var CHUNK = 0x8000;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      resolve('data:' + blob.type + ';base64,' + btoa(binary));
    }, reject);
  });
}

/* --------------------------------------------------------------------------
 * 消息路由
 * ------------------------------------------------------------------------ */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    /* content.js → background：图片列表已提取完成 */
    case 'EIMG_IMAGES': {
      var tabId = sender.tab ? sender.tab.id : Date.now();
      var key = STORAGE_PREFIX + tabId;
      var payload = {
        images: msg.images,
        sourceUrl: sender.tab ? sender.tab.url : '',
        time: Date.now()
      };
      chrome.storage.session.set({ [key]: payload }, function () {
        var galleryUrl = chrome.runtime.getURL('gallery.html') + '?tab=' + tabId;
        chrome.tabs.create({ url: galleryUrl });
        sendResponse({ ok: true, count: msg.images.length });
      });
      return true; // 异步 sendResponse
    }

    /* gallery → background：请求在 SW 内抓取图片并转 PNG（跨域兜底方案 A） */
    case 'EIMG_FETCH_PNG': {
      fetchAndConvertToPng(msg.url)
        .then(function (dataUrl) { sendResponse({ ok: true, dataUrl: dataUrl }); })
        .catch(function (err) { sendResponse({ ok: false, error: String(err && err.message || err) }); });
      return true; // 异步 sendResponse
    }

    default:
      return false;
  }
});

/* 点击扩展图标：若存在最近一次提取结果则直接打开画廊 */
chrome.action.onClicked.addListener(function () {
  chrome.storage.session.get(null, function (all) {
    if (chrome.runtime.lastError || !all) return;
    var keys = Object.keys(all).filter(function (k) { return k.indexOf(STORAGE_PREFIX) === 0; });
    if (!keys.length) return;
    // 取时间最新的一份
    keys.sort(function (a, b) { return (all[b].time || 0) - (all[a].time || 0); });
    var tabId = keys[0].slice(STORAGE_PREFIX.length);
    chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') + '?tab=' + tabId });
  });
});

/* Service Worker 唤醒时清理过期数据 */
cleanupExpired();
