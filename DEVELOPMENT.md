# FakeLink 开发与构建

项目使用 npm 上的 Tau 插件 SDK 0.60.0。在插件仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

安装包位于 `dist/tau.fakelink-<版本>.zip`。开发版 Tau 的插件页支持在「⋯」中选择「从 ZIP 安装」。普通用户通过插件中心安装，最低桌面版本以 manifest.json 为准。
