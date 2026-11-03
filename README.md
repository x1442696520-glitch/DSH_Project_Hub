# DSH Project Hub

DSH 插件：在当前 Workspace 中管理项目资料、任务和文件，并可选连接企业微信 AI Bot 或飞书机器人。

## 功能

- 一个 Workspace 管理一个项目，项目资料保存在 `project.md`、`tasks/` 和 `files/`。
- 提供项目概览、任务看板、甘特图和项目文件浏览。
- 支持任务状态、负责人、进度、日期、关键任务和任务记录管理。
- 支持将项目文件发送给已绑定的企业微信或飞书私聊。
- 支持 UTF-8 CSV 导出，并防范表格公式注入。
- 企业微信和飞书均通过平台长连接接收已授权的单聊消息。
- 入站附件仅保存到项目 Workspace 的 `files/`，默认不会读取文件内容或自动发送给助手。

当前不支持群聊、聊天历史、云文档/表格读写或普通个人微信号机器人。

## 安装

需要兼容的 DeepSeek Harness Host、Node.js 20 或更高版本，以及 pnpm。

```powershell
git clone https://github.com/x1442696520-glitch/DSH_Project_Hub.git
cd DSH_Project_Hub
pnpm install --frozen-lockfile
pnpm run build
```

随后在 DSH 插件管理界面选择“安装本地目录”，指向克隆后的目录并启用 `dsh-project-hub`。更新源码后重新运行 `pnpm run build`，再从 DSH 插件管理界面重新加载插件。

## 机器人凭证

优先在 Project Hub 的“办公集成”页面配置凭证。Host 会尝试将凭证保存到操作系统凭证库；凭证值不会返回浏览器。也可在启动 DSH Host 的进程环境中配置：

| 环境变量 | 用途 |
| --- | --- |
| `WECOM_AIBOT_ID` | 企业微信智能机器人 Bot ID |
| `WECOM_AIBOT_SECRET` | 企业微信智能机器人 Bot Secret |
| `FEISHU_APP_ID` | 飞书企业自建应用 App ID |
| `FEISHU_APP_SECRET` | 飞书企业自建应用 App Secret |
| `FEISHU_TENANT_KEY` | 可选；限定飞书租户 |

已保存的凭证库条目优先于环境变量。设置或修改环境变量后需重启 DSH Host。请勿把真实凭证写入代码、`.env`、Issue、截图或聊天消息。

## 文件与权限边界

- 默认拒绝未配对的私聊；只有绑定用户的单聊消息会路由到对应项目助手。
- 入站文件保存在当前项目 Workspace 的 `files/`，不自动读取或转发给模型。
- 插件的入站单文件上限为 50 MiB；单条飞书消息最多 5 个文件、累计不超过 100 MiB；主动发送文件上限为 20 MiB。
- 文件访问限定于当前项目 Workspace，并使用 DSH Host 文件系统与沙箱策略。
- 更多安全说明见 [SECURITY.md](SECURITY.md)。

## 许可证

MIT License。依赖项各自的许可证仍然适用。

