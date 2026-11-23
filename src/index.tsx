import { definePlugin, type PluginPageHandle } from "@tau/plugins";
import { FakeLink } from "./runtime";
import { readPreferences } from "./preferences";
import { Candidates, Settings } from "./views";
import "./styles.css";

declare const __PLUGIN_META__: { id: string; name: string; version: string };

export default definePlugin({
  ...__PLUGIN_META__,
  create: () => ({
    async activate(context) {
      if (!context.textDecorations)
        throw new Error("此版本的 Tau 尚未提供 FakeLink 需要的文字装饰能力。");
      const preferences = readPreferences(await context.storage.get("preferences"));
      let choices: PluginPageHandle;
      const runtime = new FakeLink(context, preferences, (title, source) =>
        choices.open({ title, ...source })
      );
      choices = context.pages.register({
        id: "candidates",
        title: "选择同名内容",
        match: "params",
        component: ({ params }) => <Candidates runtime={runtime} params={params} />,
      });
      const settings = context.settings.register({
        id: "preferences",
        title: "虚拟链接",
        component: () => <Settings runtime={runtime} />,
      });
      context.events.on(
        [
          "workspace.reset",
          "article.created",
          "article.updated",
          "article.deleted",
          "document.created",
          "document.updated",
          "document.deleted",
        ],
        event => runtime.changed(event)
      );
      context.commands.register({
        id: "rebuild",
        title: "FakeLink：重新读取标题",
        run: async () => {
          await runtime.rebuild();
          return null;
        },
      });
      // 授权弹窗与首次分页建索引可以跨越插件激活时限。
      void runtime.rebuild().catch(() => {
        if (!context.signal.aborted)
          context.notifications.send({
            title: "FakeLink 尚未开始匹配",
            body: runtime.error,
            mode: "in-app",
            actions: [{ label: "打开设置", onClick: () => settings.open() }],
          });
      });
    },
  }),
});
