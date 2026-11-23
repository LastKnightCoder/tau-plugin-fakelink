import type { PluginCard, PluginContext } from "@tau/plugins";
import { BodyIndex, passagesOf } from "./body-index";

// 分页扫描只写尚未被增量事件接管的卡片，旧任务不能覆盖新一代索引。
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

  private async read(card: PluginCard) {
    const snapshot = await this.context.content.read(card.contentRef, { format: "nodes" });
    return snapshot
      ? { id: card.id, createdAt: card.createdAt, passages: passagesOf(snapshot.nodes ?? []) }
      : null;
  }

  start() {
    this.stop();
    const controller = (this.scan = new AbortController());
    const touched = (this.scanningChanges = new Set<string>());
    const scan = async () => {
      let cursor: string | undefined;
      do {
        const page = await this.context.data.cards.query({ sort: "created", limit: 100, cursor });
        for (const card of page.items) {
          if (controller.signal.aborted) return;
          if (touched.has(card.id)) continue;
          const entry = await this.read(card);
          if (controller.signal.aborted) return;
          if (!touched.has(card.id)) {
            this.index.update(card.id, entry);
            this.changed();
          }
        }
        cursor = page.cursor;
      } while (cursor && !controller.signal.aborted);
    };
    void scan()
      .catch(error => {
        if (!controller.signal.aborted) this.report(error);
      })
      .finally(() => {
        if (this.scanningChanges === touched) this.scanningChanges = undefined;
      });
  }

  async update(id: string) {
    const scan = this.scan;
    if (!scan) return;
    const token = Symbol();
    this.scanningChanges?.add(id);
    this.changes.set(id, token);
    try {
      const card = await this.context.data.cards.get(id);
      if (scan.signal.aborted || this.changes.get(id) !== token) return;
      const entry = card ? await this.read(card) : null;
      if (scan.signal.aborted || this.changes.get(id) !== token) return;
      this.index.update(id, entry);
      this.changed();
    } finally {
      if (this.changes.get(id) === token) this.changes.delete(id);
    }
  }
}
