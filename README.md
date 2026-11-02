# Magpie CCursor

[English](README.en.md) · **简体中文**

在 **Cursor** 中直接使用你在 **Magpie** 配置的模型：由 Magpie 统一管理模型供应商、密钥与用量统计，在 Cursor 里自由切换模型、对话和运行 Agent 任务。

[AGPL-3.0-or-later](LICENSE) · 基于 [CometixSpace/CCursor](https://github.com/CometixSpace/CCursor)

`0.4.0` 在 Magpie 的 **Agent 页底部**新增默认开启的 **Cursor 中文界面**开关（汉化侧栏、设置与 Agents 窗口），模型连接和分配仍在 **Agent → CCursor** 中管理；同时包含上游 CCursor `0.0.16` 针对 **Cursor 3.27.x** 的对话协议、Agents 窗口路由与 BYOK 模式切换修复。

`magpie-ccursor` 是适配 Magpie 的 CCursor Agent 插件。它在本机运行一个轻量协议桥（`127.0.0.1:39831`），把 Cursor 的模型请求转发到 Magpie 本地网关，再由 Magpie 调用你配置的供应商。模型费用按你在 Magpie 中接入的供应商计费。

```text
Cursor → 本机 CCursor 协议桥 (127.0.0.1:39831) → Magpie 网关 → 模型供应商
```

## 快速上手

在 Magpie 安装插件后，Cursor 的接入补丁会自动安装，日常使用无需单独克隆仓库或手动执行 `setup` 命令。连接与模型配置在 Magpie 的 **Agent → CCursor** 中完成，无需额外的独立接入页面；附加中文界面默认开启，可在 **Agent 页面底部**按需切换：

1. 在 Magpie 的插件页面添加 `github:Chekhovin/magpie-ccursor`。
2. 打开 **Agent → CCursor**，启用连接并勾选要分配给 Cursor 的模型。如果安装后还未显示 CCursor，请先手动刷新一下 Magpie 页面。
3. 打开 Cursor，在模型选择器中选择模型（如果安装或更新插件时 Cursor 正在运行，请先完全退出再重新打开以加载补丁），然后发送一条测试消息：

   > 只回复「连接成功」。

使用 Cursor 期间请保持 Magpie 运行：

- 已分配的模型会同时同步到普通 IDE 窗口与 Agents 窗口；在 Magpie 中修改模型分配后会自动更新，插件升级时也无需重新勾选已有模型。
- Cursor 的 **Auto** 和未指定模型的新对话会使用 Magpie 分配的默认模型；你也可以在选择器里指定模型。
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

如果安装完成后，Magpie 的 Agent 页面没有立即出现 CCursor，请手动刷新一下页面，再启用连接并分配模型，无需重新安装插件。

插件首次加载时会查找本机 Cursor，备份原文件并自动安装接入补丁。配置集中在 **Agent → CCursor** 完成，启用连接并分配模型后打开 Cursor 即可使用；如果安装或更新插件时 Cursor 正在运行，请完全退出后再重新打开。

由本插件备份并管理的旧补丁会随插件升级自动更新。Cursor 更新后，请保持 Magpie 运行：插件会检查接入状态，为兼容的新版本重新备份、安装补丁。如果安装进程意外退出，而当前版本文件仍与完整备份一致，插件会自动恢复并重试；正在进行的接入操作结束后也会自动重试。接入完成后，完全退出再打开 Cursor 即可，无需重新分配模型。

如果新版 Cursor 改变了接口，或文件已被部分修改，插件会保留备份并在日志中提示，等待兼容修复，不会用旧版文件覆盖新版本。若 Cursor 安装在自定义目录，可为 Magpie 设置指向 `resources/app` 的 `CCURSOR_CURSOR_ROOT` 环境变量。自定义安装位置、写入权限与恢复问题，请参阅 [接入与恢复指南](docs/setup.md)。

#### 已经使用原版 CCursor

请先停止原版 CCursor 服务并关闭其自动启动，避免与本插件争用 `39831` 端口；原有安装文件可以保留。原版客户端补丁不一定兼容当前插件。如果日志提示旧补丁不完整或无法安全升级，请按原版方式恢复，或使用干净的 Cursor 安装，再让本插件自动接入。

关于已有原版安装、自定义端口、补丁兼容与恢复说明，请参阅 [接入与恢复指南](docs/setup.md)。

## 中文界面开关

在 Magpie 的 **Agent 页面底部**找到「Cursor 中文界面」面板。开关默认开启；关闭后会将 `false` 配置持久化保存（跨 Magpie 重启与插件升级保留），仅撤销插件附加的界面翻译，CCursor 接入补丁、模型分配和已有对话均不受影响。设置保存后，面板会自行刷新以激活更新后的插件宿主；请等待后台接入完成，再完全退出并重新打开 Cursor。

当前附带的翻译数据仅针对 **Cursor 3.27.22** 的两份已验证 renderer 文件（同时校验版本号与原始文件 SHA-256），覆盖普通 IDE 窗口和 Agents 窗口的侧栏、设置等界面。插件可识别同版本的英文原件与既有汉化基线，并保留内部 `Files` 与 `Hooks` 标识的英文原值以避免影响功能逻辑。不同构建、文件已被修改或其他 Cursor 版本若哈希不匹配，会标记为 `unsupported` 并自动跳过汉化，同时继续保持模型接入，不会把旧翻译强行套用到未验证的文件。

原有 VS Code 中文语言包独立管理，关闭此开关不会卸载它，因此基础编辑器界面可能仍为中文。关闭此开关只移除附加翻译并保留模型接入；而执行 `bun cli.ts restore --cursor-closed` 会还原插件首次记录的 `.original` 客户端文件并暂停自动接入。由于面板仅确认选项已保存，若重启 Cursor 后界面未变化，请查看 Magpie 插件日志或运行 `bun cli.ts status` 检查 `automaticSetup.localization`。详见[汉化与恢复说明](docs/localization.md)。

## 常用命令与配置

日常使用无需运行命令行。需要排查问题、前台调试或手动恢复客户端文件时，可在克隆的仓库目录中使用 `bun cli.ts`（需本机安装 [Bun](https://bun.sh) `>= 1.3.0`）：

| 操作或配置项 | 命令 / 说明 |
| --- | --- |
| 查看桥接与补丁状态 | `bun cli.ts status`（含自动接入与 `localization` 状态，不显示任何密钥） |
| 前台运行协议桥（调试） | `bun cli.ts start`，按 `Ctrl+C` 停止 |
| 手动重试接入 | 关闭全部 Cursor 窗口后执行 `bun cli.ts setup --cursor-closed`（亦用于在手动 `restore` 后重新启用自动接入） |
| 还原 Cursor 客户端补丁 | 关闭全部 Cursor 窗口后执行 `bun cli.ts restore --cursor-closed`（还原首次备份文件并暂停自动接入） |
| Cursor 附加汉化 | Magpie **Agent 页底部 → Cursor 中文界面**（默认开启，同步至 `~/.magpie-ccursor/plugin-options.json`） |
| 供应商、模型与 Agent key | 在 Magpie 中管理供应商与密钥，在 **Agent → CCursor** 连接并分配模型 |
| 本地配置与会话数据目录 | `~/.magpie-ccursor/`（独立存储，不读取或导入 `~/.ccursor`） |
| 连接配置文件 | `~/.magpie-ccursor/connection.json`（由 Magpie 自动写入与还原） |

> **安全提示：** `~/.magpie-ccursor/` 下的连接配置与派生配置包含本地网关密钥。提交问题或分享日志时，请勿上传这些文件或贴出其中的密钥。

## 故障排查与文档

- **接入、恢复与常见问题排查：** [docs/setup.md](docs/setup.md)
- **中文界面开关与恢复说明：** [docs/localization.md](docs/localization.md)
- **架构设计与模块说明：** [docs/architecture.md](docs/architecture.md)
- **本地开发与检查流程：** [CONTRIBUTING.md](CONTRIBUTING.md)

遇到问题？欢迎 [提交 Issue](https://github.com/Chekhovin/magpie-ccursor/issues)，反馈时请附上 Magpie、Bun 与 Cursor 的版本号、复现步骤以及脱敏后的日志输出。

## 致谢与许可证

本项目的协议桥服务与客户端补丁逻辑移植自 [CometixSpace/CCursor (`0.0.16`)](https://github.com/CometixSpace/CCursor/tree/c110c6e8ae34f785bca453c163bc113993f19b70)，针对 Magpie Agent 插件机制的改造说明记录在 [NOTICE.md](NOTICE.md)。

本项目遵循 [AGPL-3.0-or-later](LICENSE) 许可证开源。它是社区维护的第三方插件，非 Cursor、Magpie 或 CCursor 官方发布，按“原样”提供，不附带任何明示或暗示的担保。
