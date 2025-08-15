# “我的鱼缸”功能暂时隐藏说明

日期：2025-08-15

## 背景
后端“我的鱼缸（My Tanks）”相关接口尚未完全就绪。为避免用户产生错误预期或遇到空白/报错页面，现对前端进行“临时隐藏/降级处理”。当后端准备就绪，可按“恢复指南”迅速恢复到正常状态。

## 改动概要（临时隐藏）
- 登录/注册成功后的默认跳转从 `fishtanks.html` 改为主页：
  - `public/src/js/login.js`
  - `src/js/login.js`
- 导航栏与页脚中 `my tanks/我的鱼缸` 入口统一隐藏与禁用（不可聚焦/点击）：
  - `public/src/js/fish-utils.js`
  - `src/js/fish-utils.js`
  - `public/index.html`、`index.html`
  - `public/profile.html`、`profile.html`
  - `public/rank.html`、`rank.html`
  - `public/tank.html`、`tank.html`
  - `public/src/js/footer-utils.js`、`src/js/footer-utils.js`
- 排行页与公共鱼缸移除“加入我的鱼缸”入口：
  - `public/src/js/rank.js`、`src/js/rank.js`（去除图片点击触发 Add-To-Tank）
  - `public/src/js/tank.js`、`src/js/tank.js`（隐藏弹窗里的 Add-To-Tank 按钮）
- 个人页与鱼缸视图页的“跳转到我的鱼缸/编辑鱼缸”操作隐藏：
  - `public/src/js/profile.js`、`src/js/profile.js`
  - `public/src/js/fishtank-view.js`、`src/js/fishtank-view.js`
- 直接访问 `fishtanks.html` 将立即重定向到首页，避免直链进入：
  - `public/fishtanks.html`、`fishtanks.html`
- SEO 与抓取设置同步降级：
  - 从 `public/sitemap.xml`、`sitemap.xml` 移除 `fishtanks.html`
  - 从 `public/robots.txt`、`robots.txt` 移除对 `fishtanks.html` 的抓取 Allow
- 登录页已隐藏“进入我的鱼缸”按钮：
  - `public/login.html`、`login.html`
- 弹窗里“Create First Tank”引导按钮隐藏：
  - `public/src/js/modal-utils.js`、`src/js/modal-utils.js`

注：多语言文案（`public/locales/*.json`）未删除，仅不再展示，不影响后续恢复。

## 恢复指南（后端就绪后）
按需逆向恢复以下改动（推荐逐项验证）：
1) 登录/注册成功后默认跳转目标改回 `fishtanks.html`：
   - 修改 `getRedirectUrl()` 默认值：`public/src/js/login.js`、`src/js/login.js`
2) 导航/页脚中 `#my-tanks-link` 恢复显示与点击：
   - `public/src/js/fish-utils.js`、`src/js/fish-utils.js` 中取消强制 `display: none` 与 `onclick` 阻止
   - 各页面与页脚中移除行内 `style="display:none" aria-hidden tabindex=-1`
3) 排行与公共鱼缸恢复 “Add to Tank”：
   - `public/src/js/rank.js`、`src/js/rank.js` 恢复 `onclick="showAddToTankModal(...)"`
   - `public/src/js/tank.js`、`src/js/tank.js` 恢复弹窗里的 Add-To-Tank 按钮注释
4) 个人页按钮与鱼缸视图页编辑按钮恢复显示：
   - `public/src/js/profile.js`、`src/js/profile.js`
   - `public/src/js/fishtank-view.js`、`src/js/fishtank-view.js`
5) 移除 `fishtanks.html`、`public/fishtanks.html` 顶部的“立即跳转首页”脚本
6) 将 `fishtanks.html` 加回 `public/sitemap.xml`、`sitemap.xml`；在 `public/robots.txt`、`robots.txt` 允许抓取

## 校验清单
- 未登录与已登录用户均看不到“我的鱼缸”入口
- 所有指向 `fishtanks.html` 的入口均无效或被隐藏
- 直接访问 `fishtanks.html` 将回到 `index.html`
- 排行/公共鱼缸无“加入我的鱼缸”入口
- 站点地图与 robots 已无 `fishtanks.html`

## 影响范围与回滚
- 影响范围：仅前端可见性与跳转逻辑，未删除任何后端/前端能力代码，恢复为增量回滚
- 回滚：按“恢复指南”逐项恢复或回退该分支合并的提交

## 备注
为减少代码抖动，文案与结构尽量保持原位，仅通过显示/跳转禁用的方式临时隐藏，后续恢复成本低。


