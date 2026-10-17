# 电商图片提取下载助手（Chrome Extension · Manifest V3）

在淘宝 / 天猫 / 京东 / 拼多多商家版商品详情页，一键提取页面内所有商品图片，
在新标签页集中展示、自由勾选、批量下载为 PNG 格式。

## 文件结构

```
manifest.json        # MV3 配置：权限 / host_permissions / content_scripts / service worker
content.js           # Content Script：悬浮按钮注入 + 图片扫描提取（纯函数可单测）
content.css          # 悬浮按钮样式（eimg- 前缀防冲突）
background.js        # Service Worker：消息路由 / fetch+OffscreenCanvas 转 PNG / 数据暂存
gallery.html         # 画廊页面结构
gallery.css          # 响应式网格 + 进度条样式
gallery.js           # 勾选 / 全选 / 反选 / 批量下载（三级跨域兜底策略）
icons/               # 扩展图标（16/32/48/128，tools/make_icons.py 生成）
test/run-tests.js    # Node 单元测试（52 项断言）
website/index.html   # 插件展示官网（纯静态，双击即可打开）
tools/make_icons.py  # 图标生成脚本（PIL）
```

## 安装

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本文件夹（`D:\Gitproject\eimg-grabber`）
4. 扩展列表中出现「电商图片提取下载助手」即安装成功

## 使用

1. 打开任一支持平台的**商品详情页**（如 `item.taobao.com/item.htm?id=xxx`、
   `item.jd.com/xxx.html`、`mobile.yangkeduo.com/goods.html?goods_id=xxx`）
2. 页面右下角出现紫色悬浮按钮「获取图片」，点击
3. 自动打开画廊页：勾选需要的图片 → 点击「下载选中」
4. 下载完成到浏览器默认下载目录，文件名：`商品图_001.png`、`商品图_002.png`…

> 提示：若页面图片需滚动后才加载，请先在详情页滚动到底再点击「获取图片」。

## 跨域转 PNG 三级策略

1. **页面 Canvas**：`<img crossorigin>` + `canvas.toDataURL('image/png')`
   （公共 CDN 如 alicdn 通常允许跨域）
2. **Service Worker**：`fetch`（host_permissions 加持）+ `createImageBitmap`
   + `OffscreenCanvas` 转码
3. **原图兜底**：直接 `chrome.downloads.download` 保存原格式，
   保证任何情况下都能拿到图片

## 测试

```bash
node test/run-tests.js      # 52 项断言：URL 补全 / srcset / 过滤 / 去重 / 详情页识别 / 端到端提取
```
