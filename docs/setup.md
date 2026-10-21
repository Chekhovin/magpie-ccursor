# 接入与恢复

## 安装后自动接入

在 Magpie 添加 `github:Chekhovin/magpie-ccursor` 后，插件首次加载就会检查本机 Cursor，备份原文件并安装接入补丁。这个步骤不依赖 Agent 开关，也不需要单独安装 Bun 或克隆源码。

接入完成后，在 **Agent → CCursor** 中启用连接、分配模型，再打开 Cursor。如果安装插件时 Cursor 已经运行，保存工作并重启一次即可加载新补丁。插件不会替你关闭或重启 Cursor。

补丁结果和错误会出现在 Magpie 插件日志中。已有完整补丁会直接复用，不会反复生成备份。安装前保存原文件和 SHA-256 摘要，失败时回滚；若安装中途被强制退出，请保留 `~/.magpie-ccursor/patch-manifest.json` 及备份，先检查中断原因，不要叠加安装。

Cursor 在自定义目录时，可给 Magpie 设置 `CCURSOR_CURSOR_ROOT` 环境变量，指向 Cursor 的 `resources/app` 目录。自动接入需要对 Cursor 应用目录有写权限；不会自动提权。Linux 的只读 AppImage 挂载目录需先换成可写的安装目录。

## 已有 CCursor

本插件的服务代码来自全新下载的上游。已有 Cursor 客户端补丁可以继续连接默认地址 `127.0.0.1:39831`，但本插件不加载原版安装目录中的服务代码，也不导入 `~/.ccursor/providers.json`。

请先停止原版 CCursor 服务，避免争用端口。原版 Cursor++ 扩展可能在重启时自动启动服务；在其设置中关闭 `cursor2plus.server.autoStart`，并用 **Cursor++: Toggle BYOK Server** 停止当前服务。若原扩展的多窗口接管仍会重新启动服务，可在 Cursor 中禁用扩展，保留安装文件。

插件不会自动修改原配置、停止原进程或删除原版扩展。原补丁若使用自定义端口，先按原安装方式调整为默认端口，或使用干净的 Cursor 安装。不完整或无法确认来源的补丁不会被自动覆盖。

原版设置面板管理的是旧配置；新模型从 Magpie 的 CCursor Agent 同步。已有补丁读取旧 routes 的行为仍由该补丁控制。

## 手动检查与重试

正常安装不需要以下命令。需要排查时，可在安装了 [Bun](https://bun.sh)（`>= 1.3.0`）的环境中克隆仓库：

```sh
git clone https://github.com/Chekhovin/magpie-ccursor.git
cd magpie-ccursor
bun install --frozen-lockfile --ignore-scripts
bun cli.ts status
```

关闭全部 Cursor 窗口后，可以手动重试接入：

```sh
bun cli.ts setup --cursor-closed
```

`--cursor-closed` 表示你已关闭客户端，并同意命令修改 Cursor 应用文件。该标记不代替操作系统写入权限。手动接入与自动接入使用同一套备份和检查。

新补丁读取 `~/.magpie-ccursor/routes.json`，默认端口为 39831。插件不安装原版 Cursor++ 扩展，也不会因为安装补丁而发送模型请求。

## 恢复与升级

关闭 Cursor 后，在项目目录执行：

```sh
bun cli.ts restore --cursor-closed
```

恢复只处理 `~/.magpie-ccursor/patch-manifest.json` 记录的文件，保留备份与会话数据。主动恢复后，自动接入会暂停，避免立即把补丁装回去。想重新接入时，关闭 Cursor，再运行 `bun cli.ts setup --cursor-closed`。

已恢复的文件会跳过，便于从中断的恢复继续；若文件既不匹配补丁摘要也不匹配原摘要，恢复会停止，避免覆盖 Cursor 更新或用户修改。原版 CCursor 补丁不属于本插件记录，`restore` 不会卸载它。

Cursor 升级后，插件会重新检查客户端。当新版本的应用文件完整且没有遗留的部分补丁时，会保留旧版本备份，为新版本建立快照并重新接入。更新期间的混合文件、不完整补丁或中断快照需要先处理日志中的问题。不要将旧版本备份强制写回新版 Cursor。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| Agent 已连接，但 Cursor 没有模型 | 查看 Magpie 插件日志中的自动接入结果；已打开的 Cursor 需重启一次；确认 Agent 已分配模型 |
| 普通窗口有模型，但 Agents 窗口只有 Auto | 更新到 `0.2.4` 或更高版本并重启 Cursor；新版为当前窗口同步模型目录与选择器显示配置。内置 Auto 也会使用 Magpie 分配的默认模型，不需要编辑 provider 文件 |
| 模型可选，但发送后一直思考 | 更新插件至 `0.2.1` 或更高版本并重启 Cursor。此版本修复 Cursor 新版 local-loop 与桥接对话协议不匹配；`status` 的 `localLoop` 应为 `true` |
| 日志提示找不到 Cursor | 安装 Cursor，或给 Magpie 设置指向 `resources/app` 的 `CCURSOR_CURSOR_ROOT` |
| 日志提示权限不足 | 确认当前账户可写入 Cursor 应用目录 |
| 端口 39831 被占用 | 停止原 CCursor；`status` 会区分新桥接与其他服务 |
| Agent 列表没有 CCursor | 更新 Magpie，检查插件加载错误 |
| 原版侧栏仍显示旧模型 | 原版面板管理的是旧配置；新配置由 Magpie 管理 |
| 模型请求报 401/403 | 检查 Magpie 网关及供应商登录状态；不要粘贴配置文件中的密钥 |
| 关闭 Magpie 后不能对话 | 请保持 Magpie 运行；桥接随插件宿主退出 |
| 提示旧补丁不完整或快照中断 | 保留错误和备份，修复原版安装或使用干净 Cursor，不要反复叠加补丁 |
| 提示 `patch.lock` 被占用 | 等待正在进行的接入或恢复结束；若上次操作被强制中断，先确认没有接入或恢复进程并检查快照，再移除遗留锁后重试 |
| 恢复后不再自动接入 | 这是主动恢复的预期行为；需要接入时手动运行一次 `setup` |

插件页面不读取或显示账号密钥。“已连接 Magpie 页面”只表示页面通信正常，不代表客户端补丁或模型连接已经成功。
