# better-agent-browser

[English](README.md)

增强版浏览器自动化工具，扩展 [agent-browser](https://github.com/vercel-labs/agent-browser) CLI，提供并行多标签页操作、CAPTCHA/自动化拦截检测、以及按域名积累的站点经验。

| 功能 | 作用 | 实现方式 |
|------|------|---------|
| **并行标签页** | 同时打开和操作 100+ 个标签页 | 轻量 CDP 代理，通过单个 WebSocket 复用 |
| **CAPTCHA 监测** | 检测验证码和自动化拦截 | 快照模式匹配 + `navigator.webdriver` 检查 |
| **站点经验** | 按域名积累浏览知识 | Markdown 文件记录选择器、滚动容器、反爬信息 |

## 安装

### 通过 skills.sh（推荐）

```bash
npx skills add psylch/better-agent-browser -g -y
```

### 通过 Plugin Marketplace

```
/plugin marketplace add psylch/better-agent-browser
/plugin install better-agent-browser@psylch-better-agent-browser
```

### 手动安装

```bash
git clone https://github.com/psylch/better-agent-browser.git
# 将 skills/better-agent-browser 复制到你的 skills 目录
```

安装后需重启 Claude Code。

## 前置要求

- 全局安装 [agent-browser](https://github.com/vercel-labs/agent-browser) CLI
- Node.js 22+（CDP 代理依赖原生 WebSocket）
- Chrome 启用 `--remote-debugging-port` 的 CDP 模式（反爬站点推荐）

## 使用方式

### 并行标签页

```bash
# 启动 CDP 代理
node scripts/cdp-proxy.mjs &

# 批量打开 URL
curl -s -X POST http://127.0.0.1:3456/batch \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://site1.com","https://site2.com","https://site3.com"]}'

# 从所有标签页提取内容
curl -s -X POST http://127.0.0.1:3456/batch-eval \
  -H 'Content-Type: application/json' \
  -d '{"targets":["id1","id2","id3"],"expression":"document.title"}'
```

### CAPTCHA 检测

```bash
# 导航后检查是否有验证码
bash scripts/captcha-watch.sh --cdp 9333
# 退出码 0: 无验证码 | 1: 可解决的验证码 | 2: 自动化拦截（需切换到 CDP 模式）
```

### 站点经验

`references/site-patterns/` 中的按域名模式文件帮助 agent 了解特定站点的特性（滚动容器、稳定选择器、反爬要求）。

## 架构

```
agent-browser CLI ←── 交互操作（基于 ref 的点击、表单填写）
       ↕ 共享同一 Chrome 实例
CDP Proxy (cdp-proxy.mjs) ←── 批量/并行操作（打开、执行、截图）
       ↓
Chrome (--remote-debugging-port)
```

两个工具连接同一个 Chrome，共享登录状态，互不冲突。

## 文件结构

```
better-agent-browser/
├── skills/better-agent-browser/
│   ├── SKILL.md                    # 核心 skill 定义
│   ├── scripts/
│   │   ├── cdp-proxy.mjs          # 并行标签页 CDP 代理
│   │   ├── captcha-watch.sh       # CAPTCHA/自动化拦截检测
│   │   └── check-deps.sh          # 前置依赖检查
│   └── references/site-patterns/
│       ├── _template.md            # 新模式文件模板
│       ├── cloudflare.md           # Cloudflare Turnstile 模式
│       └── x.com.md               # X/Twitter 模式
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── README.md
├── README.zh.md
└── LICENSE
```

## 核心设计决策

- **CDP 代理仅约 250 行** — 极简实现，除 Node.js 22 原生 WebSocket 外无任何依赖
- **CAPTCHA 监测区分可解决与不可解决** — Playwright 浏览器（`navigator.webdriver=true`）永远无法通过 Cloudflare，即使人工操作也不行
- **站点模式由 agent 自维护** — 随着 agent 遇到新问题，模式文件会持续改进

## 许可证

MIT
