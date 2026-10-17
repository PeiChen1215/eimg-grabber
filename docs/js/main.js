/* ==========================================================================
 * 图提取 ImageGrab 官网交互脚本
 * 职责：
 *   1. 移动端汉堡菜单展开 / 收起
 *   2. 导航栏滚动阴影
 *   3. 滚动监听导航高亮（scrollspy）
 *   4. IntersectionObserver 入场动画（兄弟元素依次延迟）
 * 纯原生 JS，无依赖，双击 index.html 即可运行。
 * ========================================================================== */
(function () {
  'use strict';

  /* ==================== 1. 移动端汉堡菜单 ==================== */
  var toggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');

  function closeMenu() {
    toggle.classList.remove('is-open');
    navLinks.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '打开菜单');
  }

  if (toggle && navLinks) {
    toggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('is-open');
      toggle.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });

    // 点击任意导航链接后自动收起菜单（移动端）
    navLinks.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeMenu();
    });

    // 窗口放大到桌面断点时，强制收起菜单并复位汉堡图标
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 768) closeMenu();
    });

    // 点击页面其他区域收起菜单
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav')) closeMenu();
    });
  }

  /* ==================== 2. 导航栏滚动阴影 ==================== */
  var navbar = document.getElementById('navbar');

  function onScrollNavbar() {
    if (window.scrollY > 8) navbar.classList.add('is-scrolled');
    else navbar.classList.remove('is-scrolled');
  }
  window.addEventListener('scroll', onScrollNavbar, { passive: true });
  onScrollNavbar(); // 初始化（刷新时可能已在中部）

  /* ==================== 3. 滚动监听导航高亮（scrollspy） ==================== */
  // 参与高亮的区块（与导航 data-spy 一一对应）
  var spySections = Array.prototype.slice.call(
    document.querySelectorAll('section[id], .cta[id]')
  );
  var spyLinks = Array.prototype.slice.call(
    document.querySelectorAll('.nav__links a[data-spy]')
  );

  function setActive(id) {
    spyLinks.forEach(function (a) {
      a.classList.toggle('is-active', a.getAttribute('data-spy') === id);
    });
  }

  // 用 IntersectionObserver 判断「当前最靠上的可见区块」
  if ('IntersectionObserver' in window && spySections.length) {
    var spyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, {
      // 视口顶部起算，覆盖吸顶导航高度附近区域
      rootMargin: '-30% 0px -60% 0px',
      threshold: 0
    });
    spySections.forEach(function (s) { spyObserver.observe(s); });
  }

  /* ==================== 4. 入场淡入动画 ==================== */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if ('IntersectionObserver' in window && revealEls.length) {
    // 同父级的兄弟元素依次延迟 80ms，形成「错落出现」的效果
    var groups = new Map();
    revealEls.forEach(function (el) {
      var key = el.parentNode;
      var n = groups.get(key) || 0;
      el.style.setProperty('--reveal-delay', (n * 0.08) + 's');
      groups.set(key, n + 1);
    });

    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target); // 只播放一次
        }
      });
    }, { threshold: 0.12 });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    // 浏览器不支持时直接全部显示，保证内容可读
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }
})();
