# Magpie CCursor

[English](README.en.md) · **简体中文**

在 **Cursor** 中直接使用你在 **Magpie** 配置的模型：由 Magpie 统一管理模型供应商、密钥与用量统计，在 Cursor 里自由切换模型、对话和运行 Agent 任务。

[AGPL-3.0-or-later](LICENSE) · 基于 [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)

`magpie-ccursor` 是适配 Magpie 的 CCursor Agent 插件。它在本机运行一个轻量协议桥（`127.0.0.1:39831`），把 Cursor 的模型请求转发到 Magpie 本地网关，再由 Magpie 调用你配置的供应商。模型费用按你在 Magpie 中接入的供应商计费。

```text
Cursor → 本机 CCursor 协议桥 (127.0.0.1:39831) → Magpie 网关 → 模型供应商
```

## 快速上手

完成下方的[安装与接入](#安装与接入)后，日常使用只需三步：

1. 在 Magpie 中打开 **Agent → CCursor**，启用连接并勾选要分配给 Cursor 的模型。
2. 启动（或重启）Cursor，在模型选择器中切换到你刚分配的模型。
3. 发送一条消息测试连通性：

   > 只回复「连接成功」。

使用 Cursor 期间请保持 Magpie 运行：

- 在 Magpie 中调整分配的模型后，列表会自动同步到 Cursor。
- 模型请求通过 Magpie 为 CCursor 分配的专属 Agent key 发送，用量也会单独统计在该 Agent 下。
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

### 第二步：接入 Cursor 客户端

Cursor 需要通过本地客户端补丁将请求指向 `127.0.0.1:39831`。请根据你的当前环境选择对应方式：

#### 情况 A：尚未安装过 CCursor（干净的 Cursor）

首次使用需要对 Cursor 打一次本地接入补丁。请在安装了 [Bun](https://bun.sh)（`>= 1.3.0`）的环境中，先**关闭全部 Cursor 窗口**，然后在终端执行：

```sh
git clone https://github.com/Chekhovin/magpie-ccursor.git
cd magpie-ccursor
bun install --frozen-lockfile --ignore-scripts
bun cli.ts setup --cursor-closed
```

`setup` 会在修改前自动备份原文件，且不会安装原版 Cursor++ 扩展。完成后，先在 Magpie 中启用 CCursor 连接，再启动 Cursor。若日后升级了 Cursor 客户端，可能需要重新执行接入，详情请参阅 [接入与恢复指南](docs/setup.md)。

#### 情况 B：本机已经安装过原版 CCursor

如果你之前配置过原版 CCursor，且补丁连接的是默认地址 `127.0.0.1:39831`，无需重新打补丁即可直接复用：

1. **停止原版 CCursor 服务并关闭其自动启动**，避免与本插件争用 `39831` 端口（保留原有的补丁与文件即可）。
2. 在 Magpie 中启用 **Agent → CCursor** 连接，然后重启 Cursor。

关于已有安装、自定义端口及补丁兼容性说明，请参阅 [接入与恢复指南](docs/setup.md)。

## 常用命令与配置

在克隆的仓库目录中，你可以使用 `bun cli.ts`（需本机安装 [Bun](https://bun.sh) `>= 1.3.0`）检查运行状态、前台调试或还原客户端文件：

| 操作或配置项 | 命令 / 说明 |
| --- | --- |
| 查看桥接与补丁状态 | `bun cli.ts status`（不显示任何密钥） |
| 前台运行协议桥（调试） | `bun cli.ts start`，按 `Ctrl+C` 停止 |
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
