# 后端 API 列表与说明

本文件汇总了前端代码中实际调用到的后端接口，按功能分组列出方法、路径与用途，便于联调与部署。

- 基础网关（生产）：`https://duomoyu.life`
- 预览：`https://duomoyu.oaeen-xxc.workers.dev`
- 本地开发：`http://localhost:8787`
- 前端通过 `BACKEND_URL` 自动在本地/生产之间切换，亦可用 URL 参数 `?local=true` / `?prod=true` 强制指定。

### 实现状态（Workers 上线）
- 已实现（可用）：
  - `GET /api/fish`
  - `GET /api/fish/:id`
  - `POST /api/vote`
  - `POST /api/report`
  - `POST /uploadfish`（multipart/form-data：image、artist、needsModeration、可选 userId；图片存 R2，记录入 D1）
- 待实现（TBD）：
  - 审核/运营全部 `/api/moderate/*`
  - 自定义鱼缸全部 `/api/fishtanks/*`
  - 用户资料 `/api/profile/*`
  - 认证 `/auth/*`

---

## 公共鱼相关（5）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/fish` | 列表查询，支持 `orderBy`（`CreatedAt`/`score`/`hotScore`）、`order`、`limit`、`random`、`isVisible`、`deleted`、`startAfter`、`userId` 等参数 |
| GET | `/api/fish/:id` | 获取单条鱼详情（审核页刷新用）|
| POST | `/api/vote` | 对鱼投票（up/down）|
| POST | `/api/report` | 举报鱼（原因、UA、URL、时间等）|
| POST | `/uploadfish` | 上传图片并创建鱼（multipart/form-data：`image`、`artist`、`needsModeration`、可选 `userId`；若登录会带 `Authorization`）|

---

## 审核/运营（14）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/moderate/stats` | 审核看板统计 |
| GET | `/api/moderate/reported` | 举报鱼列表（`limit`/`offset`/`sortBy=reportCount`/`sortOrder`）|
| GET | `/api/moderate/flagged` | 被标记审核的鱼列表（`limit`/`offset`/`sort`）|
| GET | `/api/moderate/reports/:fishId` | 查看某鱼举报明细（含汇总）|
| GET | `/api/moderate/fish/:fishId` | 审核视图用的鱼详情 |
| POST | `/api/moderate/bulk-review` | 批量操作：`approve`/`delete`/`mark_validity`/`clear_reports` |
| POST | `/api/moderate/approve/:fishId` | 审核通过 |
| POST | `/api/moderate/mark-validity/:fishId` | 标注是否为鱼（`isFish`）|
| POST | `/api/moderate/flip/:fishId` | 水平翻转图片 |
| DELETE | `/api/moderate/delete/:fishId` | 删除鱼 |
| DELETE | `/api/moderate/clear-reports/:fishId` | 清空举报 |
| POST | `/api/moderate/ban/:userId` | 封禁用户或 IP（根据实际标识）|
| POST | `/api/moderate/unban/:userId` | 解禁用户或 IP |
| PATCH | `/api/moderate/update/:fishId` | 通用更新（翻转失败时的回退方案中使用）|

> 注：审核接口均要求管理权限并携带 `Authorization: Bearer <token>`。

---

## 自定义鱼缸（12）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/fishtanks/my-tanks` | 我的鱼缸列表（需登录）|
| GET | `/api/fishtanks/public` | 查看某用户公开鱼缸（`userId`）|
| GET | `/api/fishtanks/public/list` | 公开鱼缸分页/排序（`limit`/`offset`/`sortBy=name|createdAt|updatedAt|viewCount`）|
| GET | `/api/fishtanks/trending/list` | 趋势鱼缸（`limit`、`days`）|
| GET | `/api/fishtanks/popular/list` | 热门鱼缸（`limit`、`minViews`）|
| POST | `/api/fishtanks/create` | 创建鱼缸（`name`/`description`/`isPublic`）|
| GET | `/api/fishtanks/:id` | 鱼缸详情（返回 `fishtank` + `fish`）|
| PUT | `/api/fishtanks/:id` | 更新鱼缸（`name`/`description`/`isPublic`）|
| DELETE | `/api/fishtanks/:id` | 删除鱼缸 |
| POST | `/api/fishtanks/:tankId/add-fish` | 往鱼缸添加鱼（`fishId`）|
| GET | `/api/fishtanks/:tankId/stats` | 鱼缸统计（仅所有者可见）|
| DELETE | `/api/fishtanks/:tankId/fish/:fishId` | 从鱼缸移除鱼 |

---

## 用户资料（2）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/profile/:userId` | 获取用户资料（显示名、统计等）|
| PUT | `/api/profile/:userId` | 更新资料（`displayName`）|

---

## 认证（5）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/google` | Google OAuth 登录 |
| POST | `/auth/login` | 邮箱密码登录 |
| POST | `/auth/register` | 注册（可带 `displayName` 与可选 `userId` 迁移本地数据）|
| POST | `/auth/forgot-password` | 申请重置密码邮件 |
| POST | `/auth/reset-password` | 提交重置（`email`、`token`、`newPassword`）|

---

## 统计
- 合计 38 个端点（按“方法+路径”去重）。
- 分布：公共鱼 5 + 审核 14 + 鱼缸 12 + 资料 2 + 认证 5。

> 说明：上述列表基于前端实际调用整理，后端实现可能提供更多内部/管理端点，或对参数有更细校验要求，以后端为准。
