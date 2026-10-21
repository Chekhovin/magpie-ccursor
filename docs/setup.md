# 接入与恢复

## 已有 CCursor

本插件的**服务代码**来自全新下载的上游。已有 Cursor 客户端补丁可以作为协议客户端使用，但插件不加载原版安装目录中的服务代码，也不导入 `~/.ccursor/providers.json`。

兼容条件：现有 renderer、always-local / Agent Host 补丁指向 `127.0.0.1:39831`，且原版 CCursor 服务已停止。原版 Cursor++ 扩展可能在 Cursor 重启时自动启动服务；在其设置中关闭 `cursor2plus.server.autoStart`，并用 **Cursor++: Toggle BYOK Server** 停止当前服务。若原扩展的多窗口接管仍会重新启动服务，可在 Cursor 中禁用扩展，但保留安装文件。

插件不会自动修改原配置、停止原进程或删除扩展。原补丁若使用自定义端口，必须先按其原安装方式调整或在干净 Cursor 安装上运行本项目的 `setup`。不要将两套不完整补丁叠加；`setup` 会拒绝检测到的不完整 renderer 补丁。

原版设置面板读写的是旧目录，它的 provider 编辑和开关不能作为新桥接配置界面。新模型从 Magpie 的 CCursor Agent 同步。已有补丁读取旧 routes 的行为仍由该补丁控制；本插件不宣称任意历史版本都兼容。

## 干净 Cursor 的首次接入

先在 Magpie 添加 `github:Chekhovin/magpie-ccursor`，确认 Agent 页出现 CCursor。

在新下载的项目目录安装依赖并检查状态：

```sh
bun install --frozen-lockfile --ignore-scripts
bun cli.ts status
```

关闭全部 Cursor 窗口，再运行：

```sh
bun cli.ts setup --cursor-closed
```

`--cursor-closed` 表示你已关闭客户端，并同意此命令修改 Cursor 应用文件。该标记不代替操作系统权限；若 Cursor 在受保护目录中，请使用有该目录写入权限的终端。

自定义 Cursor 安装位置可以通过上游支持的 `CCURSOR_CURSOR_ROOT` 环境变量指定，它必须指向 `resources/app`。新补丁会读取 `~/.magpie-ccursor/routes.json`，默认端口仍为 39831。

安装不会写入 Cursor++ 扩展，不会启动真实模型请求。操作前会保存完整原文件和 SHA-256 摘要，补丁验证失败会尝试还原。若系统在安装中途强制退出，`patch-manifest.json` 会保持 `applying`，应先检查备份，不能直接叠加安装。

## 恢复与升级

关闭 Cursor 后，在相同项目版本执行：

```sh
bun cli.ts restore --cursor-closed
```

恢复只处理 `~/.magpie-ccursor/patch-manifest.json` 记录的文件，备份和数据保留。已恢复的文件会跳过，便于从中断的恢复继续；若文件既不匹配补丁摘要也不匹配原摘要，命令会停止，避免覆盖 Cursor 更新或用户修改。

若 Cursor 已升级导致摘要不同，请保留备份，在更新后的干净安装上重新接入；不要强制将旧版本应用文件覆盖回去。原版 CCursor 补丁不属于本插件记录，`restore` 不会卸载它。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| 端口 39831 被占用 | 停止原 CCursor；`status` 会区分新桥接与其他服务 |
| Agent 列表没有 CCursor | 更新 Magpie，检查插件加载错误及仓库根目录 `package.json` |
| 模型列表为空 | 连接 Agent，确认 Magpie 已向它分配模型，重启 Cursor 或刷新模型列表 |
| 原版侧栏仍显示旧模型 | 原版面板管理的是旧配置；新配置由 Magpie 管理 |
| 模型请求报 401/403 | 检查 Magpie 网关及供应商登录状态；不要粘贴配置文件中的密钥 |
| 关闭 Magpie 后不能对话 | 桥接随插件宿主退出，这是预期行为 |
| setup 失败或提示旧补丁不完整 | 保留错误和备份，先修复原版安装或使用干净 Cursor；不要反复叠加补丁 |

插件页面只是使用说明，不会读取或显示账号密钥。它的“已连接 Magpie 页面”只表示页面 bridge 正常，不表示模型连接已成功。
