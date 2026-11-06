# 办公软件连接器

本文说明当前源码中的企业微信和飞书集成边界。平台 API、权限和配额可能调整；首次接入前，请复核对应平台的最新文档及管理员批准的应用权限。

## 网络与凭证

连接器运行在 DSH Host 中，由 Host 使用平台 SDK 主动建立 WebSocket 长连接；本插件不提供公网 webhook 服务。Host 仍需要出站访问企业微信/飞书平台 API。浏览器 Client 不建立机器人连接，也不应获得 App Secret 或 Bot Secret。

凭证可通过 Project Hub「办公集成」配置并存储到操作系统凭证库，或在 DSH Host 进程环境中设置变量。凭证库中已保存的凭证优先于环境变量。不要把真实凭证写入源码、`.env`、项目 Workspace、Issue 或日志。

| 平台 | 环境变量 | 可选环境变量 |
| --- | --- | --- |
| 企业微信 AI Bot | `WECOM_AIBOT_ID`, `WECOM_AIBOT_SECRET` | 旧式绑定：`WECOM_DSH_SESSION_ID`, `WECOM_ALLOWED_USER_IDS` |
| 飞书企业自建应用 | `FEISHU_APP_ID`, `FEISHU_APP_SECRET` | `FEISHU_TENANT_KEY` |

首选通过 UI 建立一次性私聊配对；`WECOM_DSH_SESSION_ID` / `WECOM_ALLOWED_USER_IDS` 仅为兼容旧式 Host 配置。环境变量需注入启动 DSH Host 的进程；仅创建 `.env` 文件不会自动生效。

## 企业微信 AI Bot

- 使用 Bot ID/Secret 的 AI Bot API 长连接，不是企业微信自建应用的 Corp ID/Agent ID REST API。
- 当前实现接受授权单聊文本，并发送助手可见回复；群聊不处理。DSH 回复同步需要绑定用户明确开启。
- 授权单聊的文件附件经 SDK 下载/解密后保存到该项目 Workspace 的 `files/`。默认不读取文件内容，也不把附件发给模型。
- 项目代码的入站保护值：每个文件最大 50 MiB；主动发送文件最大 20 MiB。它们是本插件的本地限制，并非对企业微信平台配额的声明。超限文件不会保存。
- 同名附件需要在原私聊中回复「替换」或「取消」；确认超时或会话绑定变化时不覆盖。

官方资料：

- [智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463)
- [接收消息](https://developer.work.weixin.qq.com/document/path/101834)
- [回复消息](https://developer.work.weixin.qq.com/document/path/101836)
- [企业微信 AI Bot Node.js SDK](https://github.com/WecomTeam/aibot-node-sdk)

## 飞书机器人

- 使用飞书企业自建应用和官方 Node.js SDK 的 WebSocket 长连接；平台需要启用机器人并订阅对应事件。
- 用户在飞书单聊中通过一次性配对后，消息会路由到绑定的 DSH 项目助手。飞书项目选择器用于切换已授权项目；群聊不在当前范围内。
- 文本消息转交给当前项目助手。入站文件使用飞书 `message.resource.get`，必须带原消息 ID 与 `file_key`；不能用只适用于机器人已上传资源的 `file.get`。文件按绑定/授权规则保存到当前项目 Workspace 的 `files/`，默认不读取内容，也不发给模型。
- 出站文件由官方 SDK 上传后再发送文件消息；请确保飞书应用已启用机器人能力，并在租户中开通/审核通过消息与文件上传所需权限。入站保护值：每个文件最大 50 MiB；单条消息最多 5 个文件、总量最多 100 MiB。出站单文件上限为 20 MiB；平台或租户限制可能更低。
- 同名附件需要用户确认覆盖；不允许通过文件名覆盖路径边界。

官方资料：

- [飞书事件长连接](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/long-connection-mode)
- [飞书事件概述](https://open.feishu.cn/document/server-docs/event-subscription-guide/overview)
- [飞书 Open Platform Node.js SDK](https://github.com/larksuite/node-sdk)

## 绑定会话自动恢复

DSH Host 运行时，已绑定的企微/飞书单聊在对应会话不活动时会自动请求 AgentRegistry 恢复持久化会话，无需用户打开 DSH 会话窗口或设置开关。并发消息共享同一次恢复。插件在恢复前校验绑定、唯一 Workspace 成员关系和项目归属，并在恢复时及恢复后核对会话 ID 与工作目录。恢复未完成前不会记入去重记录或投递消息；失败时会拒绝投递并提示检查或打开 DSH 会话后重发。未配对或不在允许列表中的消息不会触发恢复。

该恢复调用使用 DSH 当前可用的 Agent 配置；不会自动还原原会话独有的模型、提示变量或其他 setup。若最近一次持久化请求声明了 `run_code`，插件会在恢复的 Agent 作用域重新启用 PTC 代码工具模式，并校验该请求记录的工具是否可用；无法恢复时拒绝投递，而不是静默使用缺少历史工具的 Agent。它可能在后台启动 Agent 并消耗模型资源。恢复通过 DSH 根上下文的 AgentRegistry 创建，使 Agent 生命周期归 DSH Host 管理，而不归 Project Hub 插件作用域管理；Project Hub 卸载或重载时仅撤销其 Agent 作用域内的工具注册，不 dispose 或删除本地会话。`project_hub_integrations` 提供飞书/企微连接、消息与文件操作；另一个 `project_hub_manage` 仅面向当前项目助手，支持 Agent 可见工具清单诊断、沙箱内只读 Git 变更检查、项目/任务查看及用户明确要求的任务创建、更新和节点记录。两者均只在归属的 Agent scope 注册，不全局注册、不限制 DSH 原有代码/文件/终端工具；项目助手会话不注入自定义角色或欢迎提示。连接成功后，插件会为仍活动的绑定会话重新挂载集成工具，或从有效绑定恢复缺失会话。

## 数据与权限边界

- 未配对的私聊不会转发到 DSH 项目助手。平台的「已连接」状态不等于用户已授权访问某个项目。
- 每次文件保存都限定到当前绑定项目的 DSH Workspace `files/`，使用 Host 文件系统与沙箱策略；不允许跨 Workspace 或路径穿越。
- 文件被保存不代表助手已经读取。只有用户后续在 DSH 中明确选择文件并发送，才会按 DSH 文件附件路径交给助手处理。
- 当前连接器未实现读取历史聊天、访问云文档/表格或群聊；不要把本插件的可见权限解释为这些数据已授权。
