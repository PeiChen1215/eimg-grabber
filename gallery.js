/* ==========================================================================
 * gallery.js — 图片画廊页逻辑
 * 流程：
 *   1. 从 URL 参数读取来源 tabId → 从 storage.session 读取图片列表
 *   2. 渲染响应式网格（缩略图 / 尺寸 / 复选框）
 *   3. 全选 / 反选 / 已选数量
 *   4. 批量下载：依次尝试 画布转换 → SW 抓取兜底 → 直接下载原图 三级策略
 * ========================================================================== */
(function () {
  'use strict';

  var STORAGE_PREFIX = 'eimg_list_';
  var CONCURRENCY = 3; // 同时下载的数量，避免请求风暴

  var images = [];          // [{ url, width, height }]
  var selected = new Set(); // 选中图片的索引

  /* ---------------- DOM 引用 ---------------- */
  var grid = document.getElementById('grid');
  var emptyEl = document.getElementById('empty');
  var emptyText = document.getElementById('empty-text');
  var sourceInfo = document.getElementById('source-info');
  var selectedCountEl = document.getElementById('selected-count');
  var totalCountEl = document.getElementById('total-count');
  var btnSelectAll = document.getElementById('btn-select-all');
  var btnInvert = document.getElementById('btn-invert');
  var btnDownload = document.getElementById('btn-download');
  var progressWrap = document.getElementById('progress-wrap');
  var progressText = document.getElementById('progress-text');
  var progressResult = document.getElementById('progress-result');
  var progressFill = document.getElementById('progress-fill');

  /* ========================================================================
   * 初始化：读取数据
   * ====================================================================== */
  function init() {
    var tabId = new URLSearchParams(location.search).get('tab');
    if (!tabId) { showEmpty('缺少来源页面参数，请从商品详情页重新提取。'); return; }

    chrome.storage.session.get(STORAGE_PREFIX + tabId, function (data) {
      if (chrome.runtime.lastError || !data || !data[STORAGE_PREFIX + tabId]) {
        showEmpty('图片数据已过期或不存在，请回到商品详情页重新点击「获取图片」。');
        return;
      }
      var payload = data[STORAGE_PREFIX + tabId];
      images = payload.images || [];
      if (!images.length) { showEmpty('未提取到任何图片。'); return; }

      sourceInfo.textContent = '来源：' + (payload.sourceUrl || '未知页面');
      sourceInfo.title = payload.sourceUrl || '';
      totalCountEl.textContent = images.length;
      renderGrid();
      bindToolbar();
    });
  }

  function showEmpty(text) {
    emptyText.textContent = text;
    emptyEl.hidden = false;
    grid.hidden = true;
  }

  /* ========================================================================
   * 渲染网格
   * ====================================================================== */
  function renderGrid() {
    var frag = document.createDocumentFragment();
    images.forEach(function (img, idx) {
      var card = document.createElement('div');
      card.className = 'card';
      card.dataset.index = idx;

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'card__checkbox';
      checkbox.dataset.index = idx;

      var thumb = document.createElement('img');
      thumb.className = 'card__img';
      thumb.loading = 'lazy';
      thumb.referrerPolicy = 'no-referrer'; // 部分平台校验 Referer，no-referrer 提高加载成功率
      thumb.src = img.url;
      thumb.alt = '商品图 ' + (idx + 1);

      var info = document.createElement('div');
      info.className = 'card__info';
      var size = document.createElement('span');
      size.className = 'card__size';
      size.textContent = (img.width && img.height)
        ? img.width + ' × ' + img.height + ' px'
        : '尺寸未知';
      info.appendChild(size);

      card.appendChild(checkbox);
      card.appendChild(thumb);
      card.appendChild(info);

      // 点击卡片任意位置切换勾选
      card.addEventListener('click', function () {
        toggleSelect(idx, checkbox);
      });

      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function toggleSelect(idx, checkbox) {
    if (selected.has(idx)) {
      selected.delete(idx);
      checkbox.checked = false;
      checkbox.closest('.card').classList.remove('selected');
    } else {
      selected.add(idx);
      checkbox.checked = true;
      checkbox.closest('.card').classList.add('selected');
    }
    updateCount();
  }

  function updateCount() {
    selectedCountEl.textContent = selected.size;
    btnDownload.disabled = selected.size === 0;
  }

  /* ========================================================================
   * 工具栏：全选 / 反选
   * ====================================================================== */
  function bindToolbar() {
    btnSelectAll.addEventListener('click', function () {
      var allChecked = selected.size === images.length;
      selected.clear();
      document.querySelectorAll('.card__checkbox').forEach(function (cb) {
        var idx = Number(cb.dataset.index);
        var checked = !allChecked; // 已全选则取消全选，否则全选
        cb.checked = checked;
        cb.closest('.card').classList.toggle('selected', checked);
        if (checked) selected.add(idx);
      });
      updateCount();
    });

    btnInvert.addEventListener('click', function () {
      document.querySelectorAll('.card__checkbox').forEach(function (cb) {
        var idx = Number(cb.dataset.index);
        toggleSelect(idx, cb);
      });
    });

    btnDownload.addEventListener('click', startDownload);
  }

  /* ========================================================================
   * 下载流程
   * ====================================================================== */

  /** 文件名规则：商品图_序号.png，序号补零（001、002…） */
  function buildFileName(seq) {
    return '商品图_' + String(seq).padStart(3, '0') + '.png';
  }

  /** 给卡片加状态角标 */
  function setBadge(idx, text, type) {
    var card = grid.querySelector('.card[data-index="' + idx + '"]');
    if (!card) return;
    var old = card.querySelector('.card__badge');
    if (old) old.remove();
    if (!text) return;
    var badge = document.createElement('span');
    badge.className = 'card__badge card__badge--' + type;
    badge.textContent = text;
    card.appendChild(badge);
  }

  /**
   * 策略 A：在页面上下文用 <canvas> 把图片转成 PNG dataURL。
   * 需要图片服务器返回 Access-Control-Allow-Origin（alicdn 等公共 CDN 通常满足）。
   */
  function convertViaCanvas(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var timer = setTimeout(function () { reject(new Error('加载超时')); }, 20000);
      img.onload = function () {
        clearTimeout(timer);
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) { reject(e); } // 画布被跨域污染会抛 SecurityError
      };
      img.onerror = function () { clearTimeout(timer); reject(new Error('图片加载失败')); };
      img.src = url;
    });
  }

  /**
   * 策略 B：请求 Service Worker 用 fetch + OffscreenCanvas 转换
   * （host_permissions 加持下可绕过部分 CORS 限制）。
   */
  function convertViaBackground(url) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ type: 'EIMG_FETCH_PNG', url: url }, function (resp) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.ok) resolve(resp.dataUrl);
        else reject(new Error((resp && resp.error) || 'Service Worker 转换失败'));
      });
    });
  }

  /** 策略 C（最终兜底）：直接下载原图（保持原格式），至少保证用户拿到图片 */
  function downloadOriginal(url, filename) {
    return new Promise(function (resolve, reject) {
      chrome.downloads.download({ url: url, filename: filename, saveAs: false }, function (id) {
        if (chrome.runtime.lastError || typeof id === 'undefined') {
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : '下载被阻止'));
        } else {
          resolve(id);
        }
      });
    });
  }

  /** 下载单个 dataURL 为文件 */
  function downloadDataUrl(dataUrl, filename) {
    return new Promise(function (resolve, reject) {
      chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false }, function (id) {
        if (chrome.runtime.lastError || typeof id === 'undefined') {
          reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : '下载被阻止'));
        } else {
          resolve(id);
        }
      });
    });
  }

  /**
   * 下载单张图片：A → B → C 逐级兜底。
   * @returns {Promise<'png'|'original'>} 实际使用的格式
   */
  async function downloadOne(idx, seq) {
    var img = images[idx];
    var pngName = buildFileName(seq);

    setBadge(idx, '下载中', 'wait');
    try {
      var dataUrl = await convertViaCanvas(img.url);
      await downloadDataUrl(dataUrl, pngName);
      setBadge(idx, 'PNG ✓', 'ok');
      return 'png';
    } catch (e1) { /* 尝试策略 B */ }

    try {
      var dataUrl2 = await convertViaBackground(img.url);
      await downloadDataUrl(dataUrl2, pngName);
      setBadge(idx, 'PNG ✓', 'ok');
      return 'png';
    } catch (e2) { /* 尝试策略 C */ }

    try {
      // 兜底直接下载原图，文件名后缀跟随原格式，避免扩展名与内容不符
      var ext = (img.url.match(/\.(jpg|jpeg|png|webp|gif)(?=[?#]|$)/i) || [null, 'jpg'])[1].toLowerCase();
      await downloadOriginal(img.url, '商品图_' + String(seq).padStart(3, '0') + '.' + ext);
      setBadge(idx, '原图 ✓', 'ok');
      return 'original';
    } catch (e3) {
      setBadge(idx, '失败', 'fail');
      throw e3;
    }
  }

  /** 批量下载：带并发限制 + 进度反馈 */
  async function startDownload() {
    var idxList = Array.from(selected).sort(function (a, b) { return a - b; });
    var total = idxList.length;
    var done = 0, pngCount = 0, originalCount = 0, failed = 0;

    btnDownload.disabled = true;
    btnSelectAll.disabled = true;
    btnInvert.disabled = true;
    progressWrap.hidden = false;
    progressResult.textContent = '';
    progressResult.className = '';
    progressFill.style.width = '0%';
    progressText.textContent = '正在下载 0 / ' + total + ' …';

    /* 简单并发池 */
    var queue = idxList.slice();
    async function worker() {
      while (queue.length) {
        var idx = queue.shift();
        var seq = idxList.indexOf(idx) + 1; // 序号按勾选顺序编号
        try {
          var mode = await downloadOne(idx, seq);
          if (mode === 'png') pngCount++; else originalCount++;
        } catch (e) {
          failed++;
        }
        done++;
        progressFill.style.width = Math.round((done / total) * 100) + '%';
        progressText.textContent = '正在下载 ' + done + ' / ' + total + ' …';
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    /* 结果反馈 */
    var parts = [];
    if (pngCount) parts.push('PNG 转换 ' + pngCount + ' 张');
    if (originalCount) parts.push('原图兜底 ' + originalCount + ' 张');
    if (failed) parts.push('失败 ' + failed + ' 张');
    progressResult.textContent = '✅ 下载完成：' + (parts.join('，') || '无') + '，请到浏览器下载目录查看。';
    progressResult.className = failed ? 'error' : 'success';
    progressText.textContent = '已完成 ' + done + ' / ' + total;

    btnDownload.disabled = selected.size === 0;
    btnSelectAll.disabled = false;
    btnInvert.disabled = false;
  }

  init();
})();
