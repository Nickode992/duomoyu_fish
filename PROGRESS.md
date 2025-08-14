## duomoyu 部署进度（Cloudflare Workers）

### 架构与运行原理
- **前端层（静态）**：
  - 由 Workers Assets 托管（`public/`），HTML/CSS/JS 与 ONNX 前端推理依赖按需加载。
  - 前端通过 `src/js/fish-utils.js` 自动选择后端基址（本地 `http://localhost:8787`，线上 `window.location.origin`）。
- **后端层（Workers）**：
  - 单一 Worker（`worker/src/index.js`）同时处理静态与 API；总入口带全局 try/catch，异常返回 JSON，避免落到 HTML 兜底。
  - 路由通过 `fetch` 中的路径前缀判定转发到 API 处理。
- **存储层**：
  - 图片：R2（bucket `duomoyu-images`），Worker 通过 `env.BUCKET.put/get` 读写；对外通过同域代理 `GET /r2/*` 暴露。
  - 结构化数据：D1（`duomoyu-db`），使用 `prepare().bind().all()/first()/run()`；已建表 `fish`、`reports`。
- **上传链路**：
  1) 前端将画布转 PNG，POST `multipart/form-data` 到 `/uploadfish`；
  2) Worker 读取 `formData`，写入 R2 `fish/{uuid}.png`，构造同域可读 URL `/r2/fish/{uuid}.png`；
  3) Worker 记录元数据到 D1（`fish` 表）并返回 JSON（`{success:true, data: {id, userId, artist, Image}}`）。
- **模型文件（ONNX）**：
  - 为绕过 25MiB 资产上限，模型放入 R2 `models/`；`GET /fish_doodle_classifier.onnx` 在 Worker 中转到 `GET /r2/models/fish_doodle_classifier.onnx`。
- **错误处理**：
  - Worker 顶层 try/catch，API 抛错统一 `application/json`；已修复此前错误落到 HTML 导致前端 JSON 解析失败的问题。

### 已完成
- 项目重命名：Workers 名称改为 `duomoyu`
- 静态资源托管：启用 Workers assets，目录 `public/`
- D1 数据库：创建并绑定（`duomoyu-db`，binding `DB`，database_id `aac6e1c5-1f4a-4424-a5e3-4e1d8d22cf1f`）
- R2 存储桶：创建并绑定（`duomoyu-images`，binding `BUCKET`）
- 数据库迁移：执行 `migrations/0001_init.sql`（表 `fish`、`reports`）
- Worker MVP API：`GET /api/fish`、`GET /api/fish/:id`、`POST /api/vote`、`POST /api/report`、`POST /uploadfish`、`GET /r2/*`、`GET /fish_doodle_classifier.onnx`
- 前端适配：`src/js/fish-utils.js` `BACKEND_URL` 同域/本地自动切换
- ONNX 模型文件改走 R2，规避 25MiB 资产限制
- 成功部署：`https://duomoyu.oaeen-xxc.workers.dev`

#### 品牌与内容清理（本次新增）
- 站点品牌统一为 `duomoyu.life`：
  - 将页面内 `drawafish.com` 全量替换为 `duomoyu.life`（`index.html`、`tank.html`、`rank.html`、`profile.html`、`fishtanks.html`，含 `public/` 镜像）。
  - 更新 Open Graph/Twitter 标签与 `link rel=canonical` 指向 `https://duomoyu.life`。
  - 更新 `sitemap.xml`、`robots.txt`、`CNAME`（根目录与 `public/`）到 `duomoyu.life`。
- 移除 Google Analytics（gtag）：清理 `index/tank/rank/profile/fishtanks/login/fishtank-view/moderation/swipe-moderation` 及其 `public/` 镜像中的 GA 代码。
- 增加原作者 credit：
  - 统一页脚由 `src/js/footer-utils.js` 注入，文案为：`© duomoyu.life | Credit: built upon DrawAFish by fifteen.games`，并链接到原仓库与作者站点。
  - 首页此前未加载页脚，已在 `index.html` 与 `public/index.html` 引入 `src/js/footer-utils.js` 以展示 credit。
- 链接修正：移除不准确的仓库链接（`https://github.com/nickode992/fishes`）。

### 路由一览（当前）
- 静态：`/*`（Assets）
- 模型：`GET /fish_doodle_classifier.onnx` → R2 代理
- 图片代理：`GET /r2/*` → R2 读取
- 鱼：`GET /api/fish`、`GET /api/fish/:id`
- 投票：`POST /api/vote`
- 举报：`POST /api/report`
- 上传：`POST /uploadfish`

### 关键文件
- `wrangler.toml`
- `worker/src/index.js`
- `migrations/0001_init.sql`
- `public/`（静态站点目录）

### 环境与版本
- Wrangler：`4.29.1`
- 运行时绑定：
  - D1：`DB = duomoyu-db (aac6e1c5-1f4a-4424-a5e3-4e1d8d22cf1f)`
  - R2：`BUCKET = duomoyu-images`
  - Assets：`ASSETS`（目录 `public/`）
  - Env：`JWT_SECRET`

### 自定义域名（duomoyu.life）
- Wrangler 配置：
  - `routes = [{ pattern = "duomoyu.life", custom_domain = true }, { pattern = "www.duomoyu.life", custom_domain = true }]`
- 实测：
  - `https://duomoyu.life`：200（命中静态首页）
  - `https://duomoyu.life/api/fish?limit=1`：200 JSON（命中 Worker API）
  - `https://www.duomoyu.life`：HEAD 405（GET 预计可用）；如需统一到根域，建议在 Worker 增加 301 跳转（将 Host 以 `www.` 开头的请求重定向到根域）。

> 文档链接：[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

### 主要命令（记录）
```bash
npx wrangler login
npx wrangler d1 create duomoyu-db
npx wrangler d1 execute duomoyu-db --file=./migrations/0001_init.sql
npx wrangler r2 bucket create duomoyu-images
npx wrangler r2 object put duomoyu-images/models/fish_doodle_classifier.onnx --file=./fish_doodle_classifier.onnx --remote
npx wrangler dev
npx wrangler deploy
```

### 注意事项
- 资产目录改为 `public/`，避免将 `.wrangler/state` 本地缓存打包。
- `fish_doodle_classifier.onnx` 通过 `GET /fish_doodle_classifier.onnx` 由 Worker 转发到 R2，无需改前端。
- 建议设置线上随机密钥：`npx wrangler secret put JWT_SECRET`。

### 下一步
- 鱼缸与资料模块：实现 `/api/fishtanks/*`、`/api/profile/*`
- 审核后台：实现 `/api/moderate/*` 并加管理鉴权
- 账号体系：实现 `/auth/*`（Cloudflare Access/JWT 或 Auth.js + D1）
- 图片访问策略：签名 URL 或公共策略
- 自定义域名/路由：在 `wrangler.toml` 增加 `routes` 并配置 DNS

> 待办建议：
> - 如需在首页顶部显著展示 credit，可在 `index.html` 增加固定提示条（当前为页脚显示）。
> - README 仍含原项目描述/链接，可按需改写为新项目介绍，并在文末保留致谢链接。


