# 言笺 KotoNote

中日英专业术语背诵与便签本（内置 187 条测试与硬件、显示面板与光学触控等领域术语），支持语音朗读、批量导入、便签记录与移动端全屏使用。

本仓库包含最新的两个版本（v2）：

## 目录结构

- **`static/`** — 纯静态单文件离线版（源自 `kotonote-static-v2.html`）
  - 无需服务器与后端，直接下载 `static/index.html` 在浏览器中打开，或通过 GitHub Pages 托管即可使用。
  - 数据保存在浏览器本地存储（`localStorage`）。

- **`retiehe/`** — 热铁盒网页托管版（源自 `kotonote-retiehe-v2.zip`）
  - 前端 + 热铁盒 Python 云函数（`api/kotonote.py`）+ 热铁盒内置 KV 数据库（`kotonote_db`），支持手机与电脑多端实时云端同步。
  - 部署方式见 [`retiehe/热铁盒上传说明.txt`](retiehe/热铁盒上传说明.txt)。

## 快速使用

### 1. 纯静态版
直接打开 `static/index.html` 即可开始使用。

### 2. 热铁盒部署版
1. 将 `retiehe/` 目录下的全部文件与文件夹上传至热铁盒站点根目录。
2. 访问 `/api/kotonote.py?action=health` 验证云函数与 KV 数据库状态，返回 `"status": "ok"` 即表示部署成功。
3. 首次访问会自动初始化全部 187 条默认术语到云端 KV 数据库。

> **iPhone 使用建议**：建议使用 Safari 打开（避免微信/QQ 内置浏览器），关闭机身静音开关；点击底部「分享 → 添加到主屏幕」即可全屏体验。
