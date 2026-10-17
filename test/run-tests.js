/* ==========================================================================
 * run-tests.js — content.js 纯函数的 Node 单元测试（无需浏览器）
 * 运行：node test/run-tests.js
 * ========================================================================== */
'use strict';

require('../content.js'); // 纯函数命名空间挂在 globalThis.EImg 上
const E = globalThis.EImg;

let passed = 0, failed = 0;
function assert(cond, name, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (extra ? ' —— ' + extra : '')); }
}

/* ---------- 1. toAbsolute：相对路径补全 ---------- */
console.log('\n[1] toAbsolute 相对路径补全');
assert(E.toAbsolute('/a/b.jpg', 'https://item.jd.com/') === 'https://item.jd.com/a/b.jpg', '根路径补全');
assert(E.toAbsolute('a.jpg', 'https://item.jd.com/x/') === 'https://item.jd.com/x/a.jpg', '相对路径补全');
assert(E.toAbsolute('//img.alicdn.com/t.png', 'https://detail.tmall.com/') === 'https://img.alicdn.com/t.png', '协议相对路径补全');
assert(E.toAbsolute('https://a.com/x.webp?x=1#y', 'https://b.com/') === 'https://a.com/x.webp?x=1#y', '绝对地址原样保留');
assert(E.toAbsolute('http://', 'https://a.com/') === null, '非法地址返回 null');
assert(E.toAbsolute('data:image/png;base64,xx', 'https://a.com/') === 'data:image/png;base64,xx', 'dataURL 原样返回（后续过滤）');

/* ---------- 2. isHttpImageUrl ---------- */
console.log('\n[2] isHttpImageUrl 协议过滤');
assert(E.isHttpImageUrl('https://a.com/1.jpg') && E.isHttpImageUrl('http://a.com/1.jpg'), '接受 http/https');
assert(!E.isHttpImageUrl('data:image/png;base64,xx'), '拒绝 data:');
assert(!E.isHttpImageUrl('blob:https://a.com/x'), '拒绝 blob:');
assert(!E.isHttpImageUrl('javascript:alert(1)'), '拒绝 javascript:');

/* ---------- 3. parseSrcset ---------- */
console.log('\n[3] parseSrcset 解析');
assert(JSON.stringify(E.parseSrcset('a.jpg 1x, b.jpg 2x')) === JSON.stringify(['a.jpg', 'b.jpg']), '1x/2x 格式');
assert(JSON.stringify(E.parseSrcset('a.jpg 400w, b.jpg 800w')) === JSON.stringify(['a.jpg', 'b.jpg']), 'w 描述符格式');
assert(E.parseSrcset('').length === 0 && E.parseSrcset(null).length === 0, '空值返回空数组');
assert(JSON.stringify(E.parseSrcset('  a.jpg  ')) === JSON.stringify(['a.jpg']), '去除首尾空白');

/* ---------- 4. parseBackgroundImage ---------- */
console.log('\n[4] parseBackgroundImage 解析');
assert(E.parseBackgroundImage('none').length === 0, 'none 返回空');
assert(JSON.stringify(E.parseBackgroundImage('url("https://a.com/x.jpg")')) === JSON.stringify(['https://a.com/x.jpg']), '双引号');
assert(JSON.stringify(E.parseBackgroundImage("url('https://a.com/x.jpg')")) === JSON.stringify(['https://a.com/x.jpg']), '单引号');
assert(JSON.stringify(E.parseBackgroundImage('url(https://a.com/x.jpg)')) === JSON.stringify(['https://a.com/x.jpg']), '无引号');
assert(E.parseBackgroundImage('linear-gradient(#fff,#000), url(a.png)').length === 1, '混合背景只取 url');

/* ---------- 5. isSuspiciousUrl：图标/logo/占位图过滤 ---------- */
console.log('\n[5] isSuspiciousUrl 启发式过滤');
assert(E.isSuspiciousUrl('https://a.com/icon/search.png'), '过滤 /icon/');
assert(E.isSuspiciousUrl('https://a.com/img/logo-white.png'), '过滤 logo');
assert(E.isSuspiciousUrl('https://a.com/sprite/header.2019.png'), '过滤雪碧图 sprite');
assert(E.isSuspiciousUrl('https://a.com/blank.gif'), '过滤 blank.gif');
assert(E.isSuspiciousUrl('https://a.com/spaceball.gif?x=1'), '过滤占位 gif');
assert(E.isSuspiciousUrl('https://a.com/loading-spinner.png'), '过滤 loading 图');
assert(!E.isSuspiciousUrl('https://img.alicdn.com/imgextra/i1/220x220q90.jpg'), '正常商品图不误伤');

/* ---------- 6. isTooSmall：尺寸过滤 ---------- */
console.log('\n[6] isTooSmall 尺寸过滤');
assert(E.isTooSmall(50, 200, 100) === true, '宽 <100 丢弃');
assert(E.isTooSmall(200, 50, 100) === true, '高 <100 丢弃');
assert(E.isTooSmall(800, 800, 100) === false, '大图保留');
assert(E.isTooSmall(0, 0, 100) === false, '未知尺寸不过滤（懒加载未加载场景）');

/* ---------- 7. dedupe：去重 ---------- */
console.log('\n[7] dedupe 去重');
{
  const items = [
    { url: 'https://a.com/x.jpg' },
    { url: 'https://a.com/x.jpg#frag' },              // hash 不同 → 视为同一张
    { url: 'https://a.com/x.jpg?_=123' },             // 防缓存参数 → 视为同一张
    { url: 'https://a.com/y.jpg' }
  ];
  assert(E.dedupe(items).length === 2, '相同图片（忽略 hash 与防缓存参数）只保留一张');
}

/* ---------- 8. isProductPage：平台详情页识别 ---------- */
console.log('\n[8] isProductPage 商品详情页识别');
const P = (host, path, search) => E.isProductPage({ hostname: host, pathname: path, search: search || '' });
assert(P('item.taobao.com', '/item.htm', '?id=123456') === true, '淘宝 item.htm?id=');
assert(P('detail.tmall.com', '/item.htm', '?spm=a1z10&id=998') === true, '天猫 item.htm?id=');
assert(P('item.jd.com', '/100012043978.html', '') === true, '京东 item.jd.com/xxx.html');
assert(P('www.jd.com', '/product/100012.html', '') === true, '京东 /product/xxx');
assert(P('mobile.yangkeduo.com', '/goods.html', '?goods_id=123') === true, '拼多多 goods.html?goods_id=');
assert(P('mms.pinduoduo.com', '/goods/goods_detail', '?goodsId=9') === true, '拼多多商家版 goods');
assert(P('item.taobao.com', '/search.htm', '?q=phone') === false, '淘宝搜索页不显示');
assert(P('www.jd.com', '/', '') === false, '京东首页不显示');
assert(P('www.baidu.com', '/item.htm', '?id=1') === false, '非电商平台不显示');

/* ---------- 9. buildImageList：端到端提取 + 过滤 + 去重（模拟 DOM） ---------- */
console.log('\n[9] buildImageList 端到端提取（模拟 DOM）');
{
  // 模拟 <img>：带懒加载属性、尺寸、坏 URL
  function fakeImg(attrs, w, h) {
    return { getAttribute: k => (k in attrs ? attrs[k] : null), naturalWidth: w, naturalHeight: h };
  }
  const imgs = [
    fakeImg({ src: 'https://img.alicdn.com/main1.jpg' }, 800, 800),           // 正常大图
    fakeImg({ src: 'icon.png' }, 32, 32),                                     // 小图标（尺寸过滤）
    fakeImg({ 'data-src': 'https://cdn.pddpic.com/main2.webp' }, 0, 0),       // 懒加载大图（未知尺寸保留）
    fakeImg({ src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, 1, 1),     // 1x1 data 图
    fakeImg({ src: 'https://img.alicdn.com/logo.png' }, 200, 200),            // logo（启发式过滤）
  ];
  const scripts = [{ textContent: 'window.DATA={"pics":["https://img30.360buyimg.com/sku/jd1.jpg"]}' }];
  const doc = {
    querySelectorAll(sel) {
      if (sel === 'img') return imgs;
      if (sel === 'source') return [];
      if (sel === 'video[poster]') return [];
      if (sel === 'script:not([src])') return scripts;
      return []; // background-image 等
    }
  };
  const loc = { hostname: 'item.taobao.com', origin: 'https://item.taobao.com' };
  const list = E.buildImageList(doc, loc, () => 'none');
  const urls = list.map(i => i.url);

  assert(list.length === 3, '提取到 3 张有效图（实际 ' + list.length + '）');
  assert(urls.includes('https://img.alicdn.com/main1.jpg'), '保留 img.src 大图');
  assert(urls.includes('https://cdn.pddpic.com/main2.webp'), '保留 data-src 懒加载图');
  assert(urls.includes('https://img30.360buyimg.com/sku/jd1.jpg'), '内联脚本中的京东图片被捞出');
  assert(!urls.some(u => u.includes('icon.png')), '过滤 32x32 小图标');
  assert(!urls.some(u => u.includes('logo.png')), '过滤 logo');
  assert(!urls.some(u => u.startsWith('data:')), '过滤 data: 1x1 图');
  assert(list.every(i => i.url.startsWith('https://')), '全部为绝对 https 地址');
}

/* ---------- 10. collectFromDocument：srcset / poster / background-image ---------- */
console.log('\n[10] collectFromDocument 多来源收集');
{
  const sources = [{ getAttribute: k => (k === 'srcset' ? 's1.jpg 1x, s1-big.jpg 2x' : null) }];
  const videos = [{ getAttribute: () => 'poster.jpg' }];
  const bgEls = [{ bg: 'url("bg1.jpg"), linear-gradient(#fff,#000)' }, { bg: 'none' }];
  const doc = {
    querySelectorAll(sel) {
      if (sel === 'img') return [];
      if (sel === 'source') return sources;
      if (sel === 'video[poster]') return videos;
      if (sel === 'div, span, li, a, section, figure, td, ul') return bgEls;
      return [];
    }
  };
  const getStyle = el => el.bg;
  const list = E.collectFromDocument(doc, getStyle);
  const urls = list.map(i => i.url);
  assert(urls.includes('s1.jpg') && urls.includes('s1-big.jpg'), '收集 <source> srcset');
  assert(urls.includes('poster.jpg'), '收集 video poster');
  assert(urls.includes('bg1.jpg') && !urls.some(u => u.includes('gradient')), '收集 background-image 且忽略渐变');
  assert(urls.length === 4, '共收集 4 个候选（实际 ' + urls.length + '）');
}

/* ---------- 结果汇总 ---------- */
console.log('\n======================================');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed > 0) process.exit(1);
