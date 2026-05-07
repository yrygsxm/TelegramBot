# Telegram 私聊机器人 - Cloudflare Pages 版

这个目录已经整理成一个可部署的 Cloudflare Pages Advanced Mode 项目。

## 目录结构

- `dist/_worker.js`
  Pages Advanced Mode 的主入口，负责 Telegram Webhook、管理员命令、关键词自动封禁、验证码和周报接口。
- `dist/index.html`
  最小静态页面，用来验证 `env.ASSETS.fetch(request)` 回退是否正常。
- `wrangler.jsonc`
  Pages 项目配置。
- `cron-worker/`
  一个独立的 Cloudflare Worker，用 Cron Trigger 每周调用一次 Pages 内部周报接口。

## 先改这两个地方

1. 在 [wrangler.jsonc](/Users/simon/Documents/tg 私聊机器人🤖/wrangler.jsonc:1) 里把 `name` 改成你现有的 Pages 项目名。
2. 在 [wrangler.jsonc](/Users/simon/Documents/tg 私聊机器人🤖/wrangler.jsonc:1) 里把 `kv_namespaces[0].id` 改成你自己的 KV Namespace ID。

如果你还没有 KV，可以先创建：

```bash
npx wrangler kv namespace create nfd
```

官方命令参考：[Wrangler KV](https://developers.cloudflare.com/workers/wrangler/commands/kv/)

## 本地开发

1. 把 [.dev.vars.example](/Users/simon/Documents/tg 私聊机器人🤖/.dev.vars.example:1) 复制成 `.dev.vars` 并填好机器人信息。
2. 运行：

```bash
npx wrangler pages dev
```

访问本地地址后，主页会显示一个状态页。

## 生产环境 - Pages

先设置 Pages secrets：

```bash
npx wrangler pages secret put ENV_BOT_TOKEN --project-name tg-private-chat-bot
npx wrangler pages secret put ENV_BOT_SECRET --project-name tg-private-chat-bot
npx wrangler pages secret put ENV_ADMIN_UID --project-name tg-private-chat-bot
```

如果你的 Pages 项目名不是 `tg-private-chat-bot`，把上面的 `--project-name` 改成真实项目名。

然后部署：

```bash
npx wrangler pages deploy dist
```

官方参考：

- [Pages Advanced Mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)
- [Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Pages secrets](https://developers.cloudflare.com/workers/wrangler/commands/pages/)

## 生产环境 - 每周周报

Cloudflare 官方的 Pages Wrangler 配置文档没有 Pages 项目的 `triggers.crons` 配置入口，所以这个仓库额外放了一个很小的 `cron-worker` 来负责定时调用周报接口。

先修改 [cron-worker/wrangler.jsonc](/Users/simon/Documents/tg 私聊机器人🤖/cron-worker/wrangler.jsonc:1)：

- `name` 改成你想用的 Worker 名称
- `REPORT_ENDPOINT` 改成你的 Pages 域名，例如 `https://bot.example.com/weekly-ban-report`

再设置 cron worker 的 secret：

```bash
npx wrangler secret put REPORT_SECRET -c cron-worker/wrangler.jsonc
```

`REPORT_SECRET` 的值必须和 Pages 侧的 `ENV_BOT_SECRET` 相同，因为内部周报接口会用这个值鉴权。

部署 cron worker：

```bash
npx wrangler deploy -c cron-worker/wrangler.jsonc
```

本地测试 cron：

```bash
npx wrangler dev -c cron-worker/wrangler.jsonc --test-scheduled
```

官方参考：[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

## Webhook 注册

部署完成后，用受保护接口注册 Telegram webhook：

```bash
curl -X POST "https://你的-pages-域名/registerWebhook" \
  -H "Authorization: Bearer 你的 ENV_BOT_SECRET"
```

取消注册：

```bash
curl -X POST "https://你的-pages-域名/unRegisterWebhook" \
  -H "Authorization: Bearer 你的 ENV_BOT_SECRET"
```

## 管理员命令

- `/banrule_add_contains 关键词 || 命中后回复语`
- `/banrule_add_exact 完整内容 || 命中后回复语`
- `/banrule_add_regex 正则表达式 || 命中后回复语`
- `/banrule_list`
- `/banrule_del 规则ID`
- `/banreport_now`
- `/block`
- `/unblock`
- `/checkblock`

## 说明

- Telegram Bot API 在私聊场景里没有给机器人一个“主动拉黑某个用户”的官方接口，所以这里实现的是机器人侧持久化封禁：一旦命中规则，后续消息都会直接被拒绝。
- `startMessage.md` 和 `notification.txt` 的默认地址我已经改成了 `raw.githubusercontent.com`，这样 Cloudflare `fetch()` 取到的是纯文本，不会把 GitHub HTML 页发给用户。
