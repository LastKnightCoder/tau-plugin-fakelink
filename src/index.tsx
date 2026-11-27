import { definePlugin } from "@tau/plugins";
import { messages } from "./i18n";
import { FakeLink } from "./runtime";
import { readPreferences } from "./preferences";
import { Settings } from "./views";
import "./styles.css";

declare const __PLUGIN_META__: { id: string; name: string; version: string };

export default definePlugin({
  ...__PLUGIN_META__,
  i18n: messages,
  create: () => ({
    async activate(context) {
      if (!context.textDecorations)
        throw new Error("此版本的 Tau 尚未提供 FakeLink 需要的文字装饰能力。");
      const preferences = readPreferences(await context.storage.get("preferences"));
      const runtime = new FakeLink(context, preferences);
      const settings = context.settings.register({
        id: "preferences",
        title: messages.ref("settings.title"),
        component: () => <Settings runtime={runtime} />,
      });
      context.events.on(
        [
          "workspace.reset",
          "card.created",
          "card.updated",
          "card.deleted",
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
        title: messages.ref("command.rebuild"),
        run: async () => {
          await runtime.rebuild();
          return null;
        },
      });
      // 授权弹窗与首次分页建索引可以跨越插件激活时限。
      void runtime.rebuild().catch(() => {
        if (!context.signal.aborted)
          context.notifications.send({
            title: context.i18n.t("notify.rebuildFailed.title"),
            body: runtime.error,
            mode: "in-app",
            actions: [
              { label: context.i18n.t("notify.openSettings"), onClick: () => settings.open() },
            ],
          });
      });
    },
  }),
});
