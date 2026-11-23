import type { PluginCard, PluginDocument, PluginArticle, PluginContext } from "@tau/plugins";
import type { SourceKind } from "./titles";
import { BodyIndex, passagesOf } from "./body-index";

export const bodyReader = (context: PluginContext, kind: SourceKind) =>
  context.data[kind === "card" ? "cards" : kind === "article" ? "articles" : "documents"];

// 分页扫描只写尚未被增量事件接管的内容，旧任务不能覆盖新一代索引。
export class BodyLibrary {
  index = new BodyIndex();
  private scan?: AbortController;
  private scanningChanges?: Set<string>;
  private changes = new Map<string, symbol>();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private context: PluginContext,
    private publish: () => void,
    private report: (error: unknown) => void
  ) {
    context.signal.addEventListener("abort", () => this.stop(), { once: true });
  }

  private changed() {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.publish();
    }, 200);
  }

  stop() {
    this.scan?.abort();
    this.scan = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.changes.clear();
    this.scanningChanges = undefined;
    this.index = new BodyIndex();
  }

  private async read(row: PluginCard | PluginArticle | PluginDocument) {
    if (!row.contentRef) return null;
    const snapshot = await this.context.content.read(row.contentRef, { format: "nodes" });
    return snapshot
      ? { title: row.title, createdAt: row.createdAt, passages: passagesOf(snapshot.nodes ?? []) }
      : null;
  }

  start(kinds: readonly SourceKind[]) {
    this.stop();
    const controller = (this.scan = new AbortController());
    const touched = (this.scanningChanges = new Set<string>());
    const scan = async () => {
      for (const kind of kinds) {
        let cursor: string | undefined;
        do {
          if (controller.signal.aborted) return;
          const page = await bodyReader(this.context, kind).query({
            sort: "created",
            limit: 100,
            cursor,
          });
          for (const row of page.items) {
            const key = kind + ":" + row.id;
            if (controller.signal.aborted) return;
            if (touched.has(key)) continue;
            const entry = await this.read(row);
            if (controller.signal.aborted) return;
            if (!touched.has(key)) {
              this.index.update({ kind, id: row.id }, entry);
              this.changed();
            }
          }
          cursor = page.cursor;
        } while (cursor && !controller.signal.aborted);
      }
    };
    void scan()
      .catch(error => {
        if (!controller.signal.aborted) this.report(error);
      })
      .finally(() => {
        if (this.scanningChanges === touched) this.scanningChanges = undefined;
      });
  }

  async update(kind: SourceKind, id: string) {
    const key = kind + ":" + id;
    const scan = this.scan;
    if (!scan) return;
    const token = Symbol();
    this.scanningChanges?.add(key);
    this.changes.set(key, token);
    try {
      const row = await bodyReader(this.context, kind).get(id);
      if (scan.signal.aborted || this.changes.get(key) !== token) return;
      const entry = row ? await this.read(row) : null;
      if (scan.signal.aborted || this.changes.get(key) !== token) return;
      this.index.update({ kind, id }, entry);
      this.changed();
    } finally {
      if (this.changes.get(key) === token) this.changes.delete(key);
    }
  }
}
