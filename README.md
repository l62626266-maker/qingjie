# 轻捷 · 随手工具箱

面向 iPhone 的移动优先 PWA，核心处理尽量在浏览器本地完成。

## 已实现

- A4 文档扫描：自动找边、手动调角、透视矫正、彩色/灰度/黑白增强
- 多页扫描、JPG 保存、A4 PDF 导出及 OCR 联动
- 本地 OCR：简体中文、英文、中英混合识别
- 图片压缩、尺寸调整、旋转、JPG/PNG/WebP 转换、元数据移除
- 文字统计、空格清理、行去重、大小写转换、空行清理
- 日期间隔与年龄计算
- 长度、重量、温度换算
- AA 分账
- 二维码生成及相机/相册识别
- 自动保存的本地便签、JSON 导出
- 深色模式、iPhone 安全区、PWA 主屏幕安装、离线外壳

## 本地运行

```bash
npm install
npm run build
npm run serve
```

访问 `http://localhost:4173`。

## 部署

将本目录部署至任意静态 HTTPS 网站即可。PWA 离线能力和主屏幕安装需要 HTTPS（`localhost` 调试除外）。

OCR 模型位于 `vendor/tessdata/`，识别过程不会把图片发送到服务器。中文与英文模型体积较大，首次进入对应识别语言时需要加载，之后由 Service Worker 缓存。

## 源码结构

- `index.html`：页面、图标和工具模板
- `styles.css`：移动优先界面与深色模式
- `app-source.js`：应用源码
- `app.js`：由 esbuild 生成的浏览器包
- `sw.js`：PWA 离线缓存
- `manifest.webmanifest`：主屏幕安装配置
- `server.mjs`：本地静态服务器
