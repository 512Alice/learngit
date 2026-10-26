# B 站学习笔记助手

## English Introduction

**Bilibili Study Note Assistant** — a lightweight, free browser extension that turns Bilibili videos into structured study notes:

1. Paste a Bilibili video link (multi-part videos supported via `&p=N`).

2. Automatically fetch the video subtitles (supports Bilibili's AI-generated subtitles; a Bilibili login is required to read them).

3. One click sends the subtitles to **Doubao**, a free AI chatbot, with a tailored prompt.

4. Doubao outputs a clean Markdown note with three parts: **Key Points** (detailed notes organized by topic), **Mind Map** (an expandable knowledge tree using Obsidian callouts — click each section title to expand its explanation), and **Key Timestamps** (`[mm:ss]` time + what happens at that point). Math symbols are converted to standard LaTeX with subscripts (`$U_{CE}$`, `$I_Z$`, `$$...$$`).

5. Automatically saves the finished note into **Obsidian** via the free Local REST API plugin — **works continuously for multiple videos**; note titles use each part's subtitle name (v3.7.40+), and the mind map is an expandable knowledge tree (v3.7.44+).

Everything is free and local-first: no API keys, no large models to download, and no data collection. Notes go only to your own Doubao conversation and your local Obsidian vault.

一个**网页式**的免费工具（基于浏览器扩展实现）：打开网页界面 → 粘贴 B 站视频链接 → 自动抓取字幕 → 一键发送给豆包 → 豆包免费输出 **核心要点 + 思维导图 + 关键节点**（公式为标准 LaTeX），整理结果**自动存入 Obsidian**（可选），**支持连续处理多个视频**。

- 不需要下载任何模型、不需要申请任何 API Key、不花一分钱

- 字幕只发给你自己的豆包对话框，不经过任何第三方服务器

- 公式在 Obsidian 中由内置 MathJax 原生渲染（`$$...$$`），物理量符号自动转标准下标（`UD`→`$U_D$`、`UZ`→`$U_Z$`、`R1`→`$R_1$`；豆包已输出的 LaTeX 下标如 `U_{CE}` 原样保留，不会二次破坏）

- 思维导图是可点击展开的知识树（Obsidian 原生 callout `> [!note]-`）：每个核心板块一个折叠块，点击标题展开该板块的详细讲解（v3.7.44+）

- 自动过滤杂鱼内容（字幕回显、历史对话、重复回答），同一回答只保存一次

***

## 一、安装（1 分钟）

1. 解压本压缩包，得到 `bilibili-note-extension` 文件夹。

2. 打开 Edge（或 Chrome），地址栏输入 `edge://extensions`（Chrome 用 `chrome://extensions`）回车。

3. 打开左下角「开发人员模式」开关。

4. 点左上角「加载解压缩的扩展」，选择 `bilibili-note-extension` 文件夹。

> 升级新版本：在 `edge://extensions` 里找到本扩展，点「重新加载」（↻）即可；确认版本号与最新一致（当前 **v3.7.46**）。

## 二、前提：登录豆包网页版（只需一次）

浏览器扩展只能操作**豆包网页版**，不能操作豆包桌面客户端。

1. 在 Edge 地址栏打开 [https://www.doubao.com/](https://www.doubao.com/)。

2. 用你的豆包账号登录（手机号扫码即可，和客户端同一个账号，免费）。

3. 登录后保持登录态即可。

4. **同时请确认 Edge 已登录 B 站账号**（在 Edge 里打开 [https://www.bilibili.com/](https://www.bilibili.com/)，点右上角头像登录）。读取 B 站的 **AI 智能字幕（自动生成字幕）必须登录**，与播放器里能否开「智能字幕」一致。未登录时接口不会返回任何字幕。

## 二・五、接入 Obsidian（可选，自动保存笔记）

如果你想把整理好的笔记自动存进 Obsidian（本地笔记库），配置一次即可：

1. **安装 Obsidian**：到 [https://obsidian.md](https://obsidian.md) 下载安装，装完创建一个笔记库（Vault），选一个文件夹即可（如 `D:\MyNotes`）。

2. 打开 Obsidian → 左下角设置 → 「第三方插件」→ 关闭「安全模式」→ 点「浏览」进入社区插件市场。

3. 搜索 **Local REST API**，安装并启用（免费）。

4. 打开 Local REST API 的插件设置：**打开「Enable Insecure Server」（启用 HTTP 服务器）开关**——插件默认主端口是 27124（HTTPS，浏览器不认它的自签名证书），必须启用 HTTP 后扩展才能用 `http://127.0.0.1:27123` 连接；记下 **API Key**。

5. 打开本扩展网页入口，在「Obsidian 自动保存设置」里：**API 地址**保持 `http://127.0.0.1:27123` 默认值（除非你改过端口），**API Key** 粘贴插件里显示的 Key，**保存目录只填 vault 内的相对路径**（如 `笔记` 或 `学习笔记/`，**不要填绝对路径**），点「保存设置」。

6. 之后每次发送给豆包整理，豆包回答完会**自动存成 .md 笔记**到 Obsidian（文件名 = 视频标题 + 日期，默认存库根目录；可在设置里填子目录如 `学习笔记/`）。

### 笔记格式与公式渲染（无需额外插件）

- 公式输出为标准 LaTeX：正文物理量自动转行内公式（`$I_D$`），大公式用 `$$...$$` 块。

- Obsidian **内置 MathJax** 原生渲染 `$$...$$`，零依赖、零网络，打开笔记即显示公式，**不需要安装任何公式插件**。

### 推荐的可选 Obsidian 插件（免费、无 API Key）

| 插件 | 作用 |
| --- | --- |
| **Linter** | 保存时自动格式化：标题层级、空行、列表、公式块前后空行、中英文空格、自动加 YAML（title/date） |
| **Style Settings** | 自定义渲染样式（公式、表格、代码块） |
| **Blue Topaz 主题** | 美化整体阅读体验（可配合 Style Settings 微调） |

> 若自动抓取豆包回答失败，豆包页面右上角会提示内容已复制；到扩展页「手动保存」粘贴写入即可。

## 三、使用

> **重要：不要直接双击打开 `app.html` 文件！** 页面必须通过扩展运行（点工具栏「B」图标或 B 站页「笔记」按钮打开），否则会报 `Cannot read properties of undefined (reading 'sendMessage')` 错误。

### 打开网页入口

- **方式一**：点击浏览器工具栏上的蓝色「B」图标；

- **方式二**：在任意 B 站视频播放页，点击右下角浮动的「笔记」按钮（会自动带上当前视频链接）。

### 完整流程

1. 把 B 站视频链接粘贴到输入框（支持分 P：链接后加 `&p=3` 表示第 3 集，不加默认第 1 集），点「**抓取字幕**」。

2. 页面显示视频标题、字幕条数与字幕预览。

3. 点「**发送到豆包整理**」：

   - 自动打开（或切换到）豆包网页版；

   - 自动把整理提示词 + 字幕填入豆包输入框并发送；

   - 豆包输出三部分：**核心要点**（按主题分小节的 Markdown 笔记）、**思维导图**（可点击展开的折叠知识树，Obsidian callout 原生渲染）、**关键节点**（`[mm:ss]` 时间点 + 该节点内容）。

4. 等待豆包整理完成：扩展**自动监控**回答，完成后**自动写入 Obsidian**（若已配置），并在豆包页右上角提示保存路径。

5. **连续处理多个视频**：处理完一个后，直接在网页入口粘贴下一个链接 → 抓取字幕 → 发送，即可继续生成（v3.7.39 起已修复第二个视频不生成的问题）。

6. 想结合视频画面补充笔记：直接在豆包对话框里发截图，让豆包结合画面内容扩展。

## 四、常见问题

| 现象 | 原因与解决 |
| --- | --- |
| 豆包页打开但没自动发送 | 插件会自动重试（轮询最多 5 分钟）。仍未发出（豆包页面结构变化时）：插件会把内容**自动复制到剪贴板**并在豆包页右上角弹提示，你在输入框手动粘贴（Ctrl+V）后回车即可。 |
| 第二个视频不生成笔记 | 旧版本存在监控锁死问题，**升级到 v3.7.39+** 并在 `edge://extensions` 点「重新加载」即可。 |
| 公式显示不出来 | 确认笔记是 `$$...$$` / `$...$` 格式；Obsidian 内置 MathJax 原生渲染，打开笔记即显示（阅读/预览模式均可）。不需要额外公式插件。若出现 `U_{C_E}` 这类下标带下划线的问题，升级到 v3.7.46+ 重新生成。 |
| 笔记里有字幕回显/历史对话/重复内容 | 新版已自动过滤：只保留最后一次 AI 回答，按内容指纹去重，字幕回显与杂鱼文案不入库。 |
| 思维导图渲染不出来 | 思维导图已改为可点击展开的知识树（Obsidian 原生 callout 语法 `> [!note]-`），阅读模式点击标题即可展开/收起，无需任何插件。若仍显示为普通引用块，请升级到 v3.7.44+ 并重新生成。 |
| 提示「没有读到字幕」 | 先确认 Edge 已登录 B 站账号（AI 智能字幕需登录）；仍失败则是该视频 / 分 P 确实没有生成字幕，请换有字幕的视频，或多 P 视频加 `&p=N` 试其他集。 |
| 字幕内容与视频对不上 | 极少数情况下 B 站接口会返回与分 P 不符的字幕。插件已优先选择与分 P 匹配的字幕，并在发送前弹出字幕开头供你核对；核对不对就不要发送，换链接重试。 |
| 多 P 视频只整理第一集 | 在链接后加 `&p=N` 指定第 N 集。 |
| 想调整笔记格式 | 直接去豆包对话框补充要求（如 "代码单独列表"、"思维导图用蓝色主题"）。 |
| 工具图标点击没反应 | 确认扩展已加载且未禁用；部分浏览器需在扩展详情里允许 "在工具栏显示"。 |

## 五、隐私说明

- 字幕由本机扩展抓取，写入本机浏览器存储，再填入你自己打开的豆包对话框。

- 发到豆包的内容会进入豆包（这是你主动发送的），请勿发送隐私或敏感内容。

- 项目源码不包含任何个人信息，可直接用于二次开发。

## 六、文件说明

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 扩展声明（权限、入口、版本） |
| `app.html` / `app.css` / `app.js` | 网页式入口界面：输入链接、抓字幕、发送豆包、Obsidian 设置 |
| `background.js` | 后台服务：抓 B 站字幕（含 wbi 签名）、打开豆包 / 网页入口、CDP 发送回车、保存到 Obsidian |
| `content-doubao.js` | 豆包页面：自动填充字幕并发送、监控回答、Markdown 还原、公式转换（`$$` + 行内下标）、折叠知识树 callout 修复、去重过滤、自动保存 |
| `content.js` | B 站页右下角「笔记」快捷按钮 |
| `content.css` | B 站页按钮样式 |
| `icons/` | 扩展图标 |
| `README.md` | 本说明 |

## 七、卸载

`edge://extensions` 里找到「B 站学习笔记助手」，点「删除」即可，不影响任何数据。
