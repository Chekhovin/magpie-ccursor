# Magpie CCursor

[English](README.en.md) · **简体中文**

让 **Cursor 使用 Magpie 中的模型**：在 Magpie 管理供应商和用量，在 Cursor 中选择模型、对话与使用 Agent。

[AGPL-3.0-or-later](LICENSE) · 基于 [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor) · 实验版本

这是 CCursor 的 Magpie **Agent 接入插件**。它在本机运行独立的 BYOK 协议桥，把 Cursor 请求送到 Magpie 网关。你需要已有可用模型的 Magpie 和 Cursor；模型费用按你在 Magpie 配置的供应商计算。

## 使用

安装后，在 Magpie 的 **Agent → CCursor** 打开连接，并为它提供模型，然后启动或重启 Cursor。在 Cursor 模型选择器里选择模型，发送一句：

> 只回复「连接成功」。

模型列表变化会自动同步。请求使用 Magpie 为 CCursor 分配的 Agent key，用量归到这个 Agent。关闭 Agent 连接后，桥接服务会停止；重新连接后恢复。使用期间请保持 Magpie 运行。

```text
Cursor → 本机 CCursor 协议桥 → Magpie 网关 → 你配置的模型供应商
```

## 安装

在 Magpie 插件页添加：

```text
github:Chekhovin/magpie-ccursor
```

或使用 Magpie CLI：

```sh
magpie plugin add github:Chekhovin/magpie-ccursor
```

入口源码已随仓库提交，Magpie 的 Bun 可直接加载，不需要 `postinstall` 或预先构建 `dist`。需要支持 Agent 插件和页面的新版 Magpie。

**已经使用 CCursor：** 停止原版 CCursor 服务并关闭它的自动启动，保留原文件与配置。如果现有补丁连接的是 `127.0.0.1:39831`，可以继续使用它。在 Magpie 连接 CCursor 后重启 Cursor。自定义端口、旧版或不完整补丁的兼容性见 [接入与恢复](docs/setup.md)。

**尚未给 Cursor 安装补丁：** 安装插件后还需进行一次 Cursor 接入。在安装了 [Bun](https://bun.sh) 的终端下载本仓库，关闭全部 Cursor 窗口，然后执行：

```sh
git clone https://github.com/Chekhovin/magpie-ccursor.git
cd magpie-ccursor
bun install --frozen-lockfile --ignore-scripts
bun cli.ts setup --cursor-closed
```

`setup` 会备份并修改 Cursor 应用文件，不安装原版 Cursor++ 扩展。完成后先在 Magpie 连接 CCursor，再启动 Cursor。Cursor 更新后可能需要重新接入，详见 [接入与恢复](docs/setup.md)。

## 配置与状态

| 项目 | 位置或行为 |
| --- | --- |
| 模型、供应商、Agent key | 由 Magpie 管理 |
| 连接配置 | `~/.magpie-ccursor/connection.json`，由 Magpie 写入与还原 |
| 派生配置和会话数据库 | `~/.magpie-ccursor/`，不导入原有 `~/.ccursor` |
| 桥接地址 | `127.0.0.1:39831`，仅监听本机 |
| 查看状态 | 在源码目录执行 `bun cli.ts status` |
| 调试前台运行 | `bun cli.ts start`，按 Ctrl+C 停止 |
| 恢复本插件写入的 Cursor 补丁 | 关闭 Cursor 后执行 `bun cli.ts restore --cursor-closed` |

连接配置和派生 provider 配置包含网关密钥，请勿上传到仓库或贴进 issue。插件不会读取本机已安装 CCursor 的 provider 配置、登录凭据或历史会话。

## 当前边界

- 已用本地模拟网关验证完整文本协议链路、模型热更新、数据库持久化、服务退出与恢复；**尚未完成真实 Magpie 界面安装及 Cursor 交互联调**。具体证据见 [验证记录](docs/verification.md)。
- 保留上游的 Agent、工具与图片处理代码；实际模型与客户端组合的兼容性需要测试。插件通过 OpenAI Chat Completions 接入 Magpie，由 Magpie 转换到供应商协议。
- 原版 CCursor 服务与此插件不能同时占用默认端口。插件不会自动结束其他进程或卸载旧版。
- 上游网页转换依赖 `supermarkdown` 的部分平台原生包下载返回 404；网页抓取转 Markdown 能力尚未验证。它不阻止已测试的文本对话链路。
- Cursor 客户端补丁依赖上游对 Cursor 版本的适配。`setup` 尚未在真实客户端上执行；不完整补丁会拒绝继续，失败会尝试恢复备份。关闭插件不会自动还原 Cursor 应用文件。

## 反馈与开发

反馈问题请附 Magpie、Bun、Cursor 版本，复现步骤和脱敏日志：[提交 issue](https://github.com/Chekhovin/magpie-ccursor/issues)。

开发与验证说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，接口和源码改动见 [架构说明](docs/architecture.md)。

## 来源与许可证

服务与补丁逻辑来自全新下载的 [CCursor `fcac85d`](https://github.com/CometixSpace/CCursor/tree/fcac85db793fc2c8cda3318b96ec5a41c24f5e26)。本项目保留 [AGPL-3.0-or-later](LICENSE)，移植说明见 [NOTICE.md](NOTICE.md)。本项目不是 Cursor、Magpie 或 CCursor 的官方发布，不提供任何保证。
