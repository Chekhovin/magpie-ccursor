# Magpie CCursor

[English](README.en.md) · **简体中文**

在 **Cursor** 中直接使用你在 **Magpie** 配置的模型：由 Magpie 统一管理模型供应商、密钥与用量统计，在 Cursor 里自由切换模型、对话和运行 Agent 任务。

[AGPL-3.0-or-later](LICENSE) · 基于 [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)

`magpie-ccursor` 是适配 Magpie 的 CCursor Agent 插件。它在本机运行一个轻量协议桥（`127.0.0.1:39831`），把 Cursor 的模型请求转发到 Magpie 本地网关，再由 Magpie 调用你配置的供应商。模型费用按你在 Magpie 中接入的供应商计费。

```text
Cursor → 本机 CCursor 协议桥 (127.0.0.1:39831) → Magpie 网关 → 模型供应商
```

## 快速上手

在 Magpie 安装插件后，Cursor 的接入补丁会自动安装，日常使用无需单独克隆仓库或手动执行 `setup` 命令。所有配置统一在 Magpie 的 **Agent → CCursor** 中完成，无需额外的独立接入页面：

1. 在 Magpie 的插件页面添加 `github:Chekhovin/magpie-ccursor`。
2. 打开 **Agent → CCursor**，启用连接并勾选要分配给 Cursor 的模型。
3. 打开 Cursor，在模型选择器中选择模型（如果安装或更新插件时 Cursor 正在运行，请先完全退出再重新打开以加载补丁），然后发送一条测试消息：

   > 只回复「连接成功」。

使用 Cursor 期间请保持 Magpie 运行：

- 已分配的模型会同时同步到普通 IDE 窗口与 Agents 窗口；在 Magpie 中修改模型分配后会自动更新，插件升级时也无需重新勾选已有模型。
- Cursor 的 **Auto** 会使用 Magpie 分配的默认模型；你也可以在选择器里指定模型。
- 模型请求通过 Magpie 为 CCursor 分配的专属 Agent key 发送，用量单独统计在该 Agent 下。
- 在 Magpie 中关闭 CCursor 连接会停止本机桥接服务，重新开启即可恢复。

## 安装与接入

使用前请准备支持 Agent 插件的 Magpie 与 Cursor 客户端。插件入口随仓库提供，由 Magpie 内置的 Bun 直接加载，无需单独安装 Bun。

### 第一步：在 Magpie 中安装插件

在 Magpie 的插件页面添加以下地址：

```text
github:Chekhovin/magpie-ccursor
```

或者通过 Magpie CLI 安装：

```sh
magpie plugin add github:Chekhovin/magpie-ccursor
```

### 第二步：启用 Agent，打开 Cursor

插件首次加载时会查找本机 Cursor，备份原文件并自动安装接入补丁。配置集中在 **Agent → CCursor** 完成，启用连接并分配模型后打开 Cursor 即可使用；如果安装或更新插件时 Cursor 正在运行，请完全退出后再重新打开。

由本插件备份并管理的旧补丁会随插件升级自动更新。安装失败时会回滚，并在 Magpie 插件日志中说明原因。Cursor 更新后，插件也会检查接入状态，为符合条件的干净新版本重新备份、安装补丁。自定义安装位置或写入权限问题，请参阅 [接入与恢复指南](docs/setup.md)。

#### 已经使用原版 CCursor

请先停止原版 CCursor 服务并关闭其自动启动，避免与本插件争用 `39831` 端口；原有安装文件可以保留。原版客户端补丁不一定兼容当前插件。如果日志提示旧补丁不完整或无法安全升级，请按原版方式恢复，或使用干净的 Cursor 安装，再让本插件自动接入。

关于已有原版安装、自定义端口、补丁兼容与恢复说明，请参阅 [接入与恢复指南](docs/setup.md)。

## 常用命令与配置

日常使用无需运行命令行。需要排查问题、前台调试或手动恢复客户端文件时，可在克隆的仓库目录中使用 `bun cli.ts`（需本机安装 [Bun](https://bun.sh) `>= 1.3.0`）：

| 操作或配置项 | 命令 / 说明 |
| --- | --- |
| 查看桥接与补丁状态 | `bun cli.ts status`（不显示任何密钥） |
| 前台运行协议桥（调试） | `bun cli.ts start`，按 `Ctrl+C` 停止 |
| 手动重试接入 | 关闭全部 Cursor 窗口后执行 `bun cli.ts setup --cursor-closed` |
| 还原 Cursor 客户端补丁 | 关闭全部 Cursor 窗口后执行 `bun cli.ts restore --cursor-closed` |
| 供应商、模型与 Agent key | 在 Magpie 中管理供应商与密钥，在 **Agent → CCursor** 连接并分配模型 |
| 本地配置与会话数据目录 | `~/.magpie-ccursor/`（独立存储，不读取或导入 `~/.ccursor`） |
| 连接配置文件 | `~/.magpie-ccursor/connection.json`（由 Magpie 自动写入与还原） |

> **安全提示：** `~/.magpie-ccursor/` 下的连接配置与派生配置包含本地网关密钥。提交问题或分享日志时，请勿上传这些文件或贴出其中的密钥。

## 故障排查与文档

- **接入、恢复与常见问题排查：** [docs/setup.md](docs/setup.md)
- **架构设计与模块说明：** [docs/architecture.md](docs/architecture.md)
- **本地开发与检查流程：** [CONTRIBUTING.md](CONTRIBUTING.md)

遇到问题？欢迎 [提交 Issue](https://github.com/Chekhovin/magpie-ccursor/issues)，反馈时请附上 Magpie、Bun 与 Cursor 的版本号、复现步骤以及脱敏后的日志输出。

## 致谢与许可证

本项目的协议桥服务与客户端补丁逻辑移植自 [CometixSpace/CCursor (`fcac85d`)](https://github.com/CometixSpace/CCursor/tree/fcac85db793fc2c8cda3318b96ec5a41c24f5e26)，针对 Magpie Agent 插件机制的改造说明记录在 [NOTICE.md](NOTICE.md)。

本项目遵循 [AGPL-3.0-or-later](LICENSE) 许可证开源。它是社区维护的第三方插件，非 Cursor、Magpie 或 CCursor 官方发布，按“原样”提供，不附带任何明示或暗示的担保。
