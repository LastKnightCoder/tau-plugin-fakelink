# FakeLink

在 Tau 桌面主窗口读写笔记时，点一下正文里出现的文章或项目文档标题，就能打开对应内容。文字仍是普通正文，保存、同步和导出都保留原文。

## 使用

1. 在带有文字装饰能力的 Tau 桌面开发版安装并启用插件，允许读取文章和项目文档。
2. 打开一篇文章或项目文档。正文里提到其他内容的标题时，点状下划线表示可以打开。同名时会列出候选，显示类型、标签和创建时间。
3. 在插件详情的「设置」中选择从哪里收录标题、在哪些正文显示，以及使用点状下划线还是背景高亮。勾选卡片后可以在卡片里使用虚拟链接。

匹配区分大小写，跳过当前内容本身。相同起点有多个标题时优先完整的长标题。英文与数字默认按 ASCII 单词边界匹配，可以在设置里关闭。标题可以跨加粗等文字格式，代码和已有行内链接会隔开匹配范围。新建、改名或删除目标后，索引随资料变化更新。命令面板中的「FakeLink：重新读取标题」可以手动重建索引。

## 本地构建

此版本依赖 Tau 桌面主窗口的 `context.textDecorations`。开发用类型随宿主一起打包。在包含这项能力的 Tau 主仓库执行：

```sh
node scripts/plugins/package-sdk.mjs /tmp/tau-fakelink-sdk
```

在本插件的临时工作副本中执行：

```sh
node use-local-sdk.mjs /tmp/tau-fakelink-sdk/*plugins*.tgz /tmp/tau-fakelink-sdk/*ui*.tgz
pnpm install --no-frozen-lockfile
pnpm test
pnpm build
```

安装包位于 `dist/tau.fakelink-0.1.0.zip`。开发版 Tau 的插件页支持在「⋯」中选择「从 ZIP 安装」。普通发行版需随宿主发布这项能力后使用。
