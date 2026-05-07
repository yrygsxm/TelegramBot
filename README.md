# Telegram 私聊机器人 - Cloudflare Pages 部署指南

这个项目已经整理成可直接部署到 Cloudflare 的版本，主逻辑在 `dist/_worker.js`。

适用场景：

- Telegram 私聊转发给管理员
- Cloudflare Pages Advanced Mode
- Workers KV 存储用户状态
- Cloudflare Turnstile 人机验证
- 每周自动发送封禁周报

## 目录说明

- `dist/_worker.js`
  机器人主程序，负责 webhook、欢迎菜单、Turnstile 验证、关键词封禁、权限管理和周报接口。
- `dist/index.html`
  一个最小静态页，用来保证 Pages 静态回退正常。
- `wrangler.jsonc`
  Pages 项目的参考配置。
- `cron-worker/src/index.js`
  每周自动触发周报的 Worker 代码。
- `cron-worker/wrangler.jsonc`
  周报 Worker 的参考配置。
- `.dev.vars.example`
  本地调试时可参考的变量示例。

## 部署前准备

你需要提前准备这些值：

- `ENV_BOT_TOKEN`
  你的 Telegram Bot Token
- `ENV_ADMIN_UID`
  管理员的 Telegram 数字 UID
- `ENV_TELEGRAM_WEBHOOK_SECRET`
  给 Telegram webhook 用的随机 secret
- `ENV_INTERNAL_SECRET`
  给内部接口和周报 Worker 用的随机 secret
- `ENV_TURNSTILE_SITE_KEY`
  Cloudflare Turnstile 的 Site Key
- `ENV_TURNSTILE_SECRET_KEY`
  Cloudflare Turnstile 的 Secret Key
- `PUBLIC_BASE_URL`
  你的最终访问域名，例如 `https://bot.example.com` 或 `https://xxx.pages.dev`

### 这些变量怎么填写

#### `ENV_BOT_TOKEN`

填写你在 `@BotFather` 里拿到的机器人 token。

格式示例：

```text
123456789:AAEXAMPLE_your_real_bot_token_here
```

获取方式：

1. 打开 Telegram
2. 搜索 `@BotFather`
3. 发送 `/token`
4. 选择你的机器人
5. 复制它返回的 token

注意：

- 必须是 BotFather 返回的完整 token
- 不要填机器人用户名
- 不要多加 `bot`
- 不要带引号或空格

#### `ENV_TELEGRAM_WEBHOOK_SECRET`

填写一串你自己生成的随机 secret，专门给 Telegram webhook 用。

格式示例：

```text
tg_webhook_4a8f9b2c7d3e1f6a9c5b8e2d4f7a1c3b
```

作用：

- 当 Telegram 调用你的 `/endpoint` 时，Cloudflare Worker 会用它校验请求是否真的是 Telegram 发来的

注意：

- 建议至少 32 位
- 只要是随机字符串即可
- 不要和 `ENV_INTERNAL_SECRET` 共用

#### `ENV_INTERNAL_SECRET`

填写另一串独立的随机 secret，给你自己的内部接口使用。

格式示例：

```text
tg_internal_7c2f4a9e1b6d3f8a5c1e9b2d7a4f6c8e
```

作用：

- 保护 `/registerWebhook`
- 保护 `/unRegisterWebhook`
- 保护 `/weekly-ban-report`
- 给每周周报 Worker 调用 Pages 内部接口时鉴权

注意：

- 也建议至少 32 位
- 必须和 `ENV_TELEGRAM_WEBHOOK_SECRET` 不同
- 周报 Worker 里的 `REPORT_SECRET` 要和它完全一致

#### `ENV_ADMIN_UID`

填写管理员自己的 Telegram 数字 UID。

格式示例：

```text
123456789
```

注意：

- 这里只填纯数字
- 不要填用户名
- 不要填手机号

获取方式有两种：

1. 最简单：先用测试 bot 跑起来，让机器人把你的消息转发或记录一次，再从日志/现有配置里确认 UID
2. 用 Telegram 里的 ID 查询机器人获取自己的数字 UID

#### `ENV_TURNSTILE_SITE_KEY`

填写你在 Cloudflare Turnstile widget 里看到的 `Site key`。

格式示例：

```text
0x4AAAAAABcDefGhijkLmnoP
```

作用：

- 给验证网页前端加载 Turnstile 组件使用

注意：

- 它来自 Turnstile 后台，不是你自己编的
- 如果你换了 Turnstile widget，这里也要同步更新

#### `ENV_TURNSTILE_SECRET_KEY`

填写你在 Cloudflare Turnstile widget 里看到的 `Secret key`。

格式示例：

```text
0x4AAAAAABcDefGhijkLmnoPqrstUvWxYz123456
```

作用：

- 后端向 Cloudflare `siteverify` 验证用户的人机校验结果时使用

注意：

- 这是后端 secret，不要泄露
- 它必须和 `ENV_TURNSTILE_SITE_KEY` 对应同一个 Turnstile widget

#### `PUBLIC_BASE_URL`

填写你真实对外访问的机器人域名。

示例 1：使用 Pages 默认域名

```text
https://tg-private-chat-bot.pages.dev
```

示例 2：使用自定义域名

```text
https://bot.example.com
```

注意：

- 必须带 `https://`
- 不要带最后的 `/`
- 不要带路径，例如不要写成 `https://bot.example.com/verify`
- 如果域名改了，要同时更新 Turnstile hostname 和 webhook 注册地址

建议：

- `ENV_TELEGRAM_WEBHOOK_SECRET` 和 `ENV_INTERNAL_SECRET` 使用不同的随机字符串
- `ENV_INTERNAL_SECRET` 至少 32 位
- 如果你启用了自定义域名，Turnstile 的 widget hostname 也要加入这个域名

## 一、部署 Pages 主项目

推荐使用 Cloudflare 网页后台直接上传。

### 1. 创建或打开 Pages 项目

1. 登录 Cloudflare
2. 进入 `Workers & Pages`
3. 如果是新项目：
   `Create application` -> `Pages` -> `Direct Upload`
4. 如果已有项目：
   直接打开你现有的项目

### 2. 上传文件

上传这个文件夹：

- `dist`

注意：

- 只上传 `dist` 文件夹
- 不要上传整个项目根目录

### 3. 创建 KV

1. 打开 Cloudflare 左侧 `存储和数据库`
2. 找到 `KV`
3. 创建一个 namespace，例如：
   `tg-private-chat-bot-kv`

### 4. 绑定 KV 到 Pages

回到 Pages 项目：

1. 打开 `Settings`
2. 打开 `Bindings`
3. `Add binding`
4. 选择 `KV namespace`
5. `Variable name` 必须填写：
   `nfd`
6. 选择刚才创建的 KV

### 5. 添加 Pages Secrets / Variables

在 Pages 项目里打开：

- `Settings`
- `Variables and Secrets`

添加这些 Secret：

- `ENV_BOT_TOKEN`
- `ENV_TELEGRAM_WEBHOOK_SECRET`
- `ENV_INTERNAL_SECRET`
- `ENV_ADMIN_UID`
- `ENV_TURNSTILE_SITE_KEY`
- `ENV_TURNSTILE_SECRET_KEY`

再添加这个普通变量：

- `PUBLIC_BASE_URL`
  例如：`https://你的-pages-域名.pages.dev`

可选普通变量：

- `WEBHOOK_PATH`
  默认 `/endpoint`
- `ENABLE_NOTIFICATION`
  默认 `true`
- `CAPTCHA_ENABLED`
  默认 `true`
- `CAPTCHA_MAX_ATTEMPTS`
  默认 `3`
- `NOTIFY_INTERVAL_MS`
  默认 `3600000`

### 6. 重新部署

如果你是新项目，首次部署完成即可。  
如果你是旧项目改配置后上线，建议再创建一次新部署并重新上传 `dist`。

## 二、注册 Telegram Webhook

推荐直接用 Telegram 官方接口注册，不必依赖项目里的 `/registerWebhook` 内部接口。

在浏览器打开：

```text
https://api.telegram.org/bot你的BOT_TOKEN/setWebhook?url=https://你的域名/endpoint&secret_token=你的ENV_TELEGRAM_WEBHOOK_SECRET
```

示例：

```text
https://api.telegram.org/bot123456:ABCDEF/setWebhook?url=https://tg-private-chat-bot.pages.dev/endpoint&secret_token=my_webhook_secret_xxx
```

如果成功，会返回：

```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

验证 bot token 是否正确，可以先打开：

```text
https://api.telegram.org/bot你的BOT_TOKEN/getMe
```

## 三、配置 Turnstile

1. 在 Cloudflare 后台打开 `Turnstile`
2. 创建一个 widget
3. Hostname 填你真正使用的域名
4. 拿到：
   - `Site key`
   - `Secret key`
5. 分别填入 Pages 的：
   - `ENV_TURNSTILE_SITE_KEY`
   - `ENV_TURNSTILE_SECRET_KEY`

验证流程现在是：

- 用户先看到欢迎菜单
- 用户点击菜单后，机器人发送一条验证消息
- 消息底部会出现 `👋 打开验证网页`
- 用户在 Telegram 内打开验证页，完成 Turnstile 后即可继续对话

## 四、部署每周周报 Worker

如果你需要每周自动收到封禁周报，再部署这个 Worker。  
如果你暂时不需要自动周报，可以先跳过这一部分，不影响机器人本体使用。

### 方式 A：推荐使用网页后台部署

1. 进入 Cloudflare `Workers & Pages`
2. 点击 `Create`
3. 创建一个新的 `Worker`
4. 打开在线编辑器
5. 把 `cron-worker/src/index.js` 的内容完整粘贴进去
6. 保存部署

然后配置：

#### 1. 添加变量

在 Worker 的 `Settings` -> `Variables and Secrets` 中添加：

- 普通变量 `REPORT_ENDPOINT`
  值填写：
  `https://你的域名/weekly-ban-report`

- Secret `REPORT_SECRET`
  值必须和 Pages 的 `ENV_INTERNAL_SECRET` 完全一致

#### 2. 添加 Cron Trigger

在 Worker 的 `Triggers` 中添加：

```text
0 0 * * MON
```

这表示每周一执行一次。

### 方式 B：命令行部署

如果你更习惯 Wrangler，也可以用：

```bash
npx wrangler secret put REPORT_SECRET -c cron-worker/wrangler.jsonc
npx wrangler deploy -c cron-worker/wrangler.jsonc
```

部署前记得把 `cron-worker/wrangler.jsonc` 里的 `REPORT_ENDPOINT` 改成真实域名。

## 五、上线到真实机器人前的检查清单

建议按这个顺序检查：

1. 用真实 bot token 调 `getMe`，确认 token 没问题
2. Pages 访问正常，域名可打开
3. `https://你的域名/endpoint` 不一定返回页面，但不能是部署缺失导致的 404
4. Webhook 注册成功
5. Turnstile widget hostname 已包含真实域名
6. 用测试号给机器人发 `/start`
7. 点击欢迎菜单任一按钮
8. 点击底部 `👋 打开验证网页`
9. 完成验证后返回对话
10. 再发送一条消息，确认管理员能收到转发

## 六、管理员常用命令

- `/help`
- `/banrule_add 关键词 || 命中后回复语`
- `/banrule_list`
- `/banreport_now`
- `/permissions`
- `/resetverify`
- `/block`
- `/unblock`
- `/checkblock`

说明：

- `/banrule_list` 现在支持在消息下方直接点按钮删除规则
- `/permissions` 会显示封禁用户分页列表，并可继续进入权限编辑
- 自动封禁提醒消息下方带有一键解封按钮

## 七、如果你要把现在的测试机器人切到真实机器人

你通常只需要替换这几项：

- `ENV_BOT_TOKEN`
- `ENV_ADMIN_UID`
- `ENV_TELEGRAM_WEBHOOK_SECRET`
- `ENV_INTERNAL_SECRET`
- `PUBLIC_BASE_URL`
- `ENV_TURNSTILE_SITE_KEY`
- `ENV_TURNSTILE_SECRET_KEY`

如果域名变了，还要同步修改：

- Turnstile widget 的 hostname
- webhook 注册地址
- 周报 Worker 的 `REPORT_ENDPOINT`

## 八、本地开发

1. 复制 `.dev.vars.example` 为 `.dev.vars`
2. 填入你自己的变量
3. 运行：

```bash
npx wrangler pages dev
```

## 九、安全说明

当前版本已经做了这些安全加固：

- Telegram webhook secret 和内部管理 secret 已拆分
- 内部接口鉴权使用独立 secret
- 敏感 secret 比较改成了常量时间比较
- 旧版 `web_app_data` 验证回传链路已废弃
- Turnstile 验证会同时校验 Telegram Mini App `initData`

仍需注意：

- `ENV_TELEGRAM_WEBHOOK_SECRET` 不要和 `ENV_INTERNAL_SECRET` 复用
- `REPORT_SECRET` 必须等于 `ENV_INTERNAL_SECRET`
- 更换 bot token 或域名后，记得重新注册 webhook

## 十、补充说明

- Telegram Bot API 没有“机器人主动拉黑私聊用户”的官方接口，所以这里实现的是机器人侧持久化封禁
- 命中关键词后，机器人会拦截后续消息，不再转发给管理员
- 周报统计支持“当前仍在封禁”和“本周新增封禁”两种口径
