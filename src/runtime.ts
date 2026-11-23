import { BodyLibrary } from "./body-library";
import { passagesOf, type BodyHit, type Passage } from "./body-index";
import { readHeadings } from "./headings";
import type {
  PluginContext,
  PluginDomainEvent,
  PluginTextDecorationHandle,
  PluginEntityReader,
  PluginArticle,
  PluginDocument,
} from "@tau/plugins";
import { TitleIndex, type Source, type Target, type TargetKind } from "./titles";
import { type Preferences } from "./preferences";

const reader = (
  context: PluginContext,
  kind: TargetKind
): PluginEntityReader<PluginArticle | PluginDocument> =>
  kind === "article" ? context.data.articles : context.data.documents;

function toTarget(kind: TargetKind, row: PluginArticle | PluginDocument | null): Target | null {
  if (!row || ("kind" in row && !row.contentRef)) return null;
  return { kind, id: row.id, title: row.title.trim(), tags: row.tags, createdAt: row.createdAt };
}

export class FakeLink {
  private index = new TitleIndex();
  private body: BodyLibrary;
  private handle?: PluginTextDecorationHandle;
  private pending = Promise.resolve();
  private listeners = new Set<() => void>();
  private revision = 0;
  error = "";

  constructor(
    readonly context: PluginContext,
    public preferences: Preferences,
    private readonly choose: (title: string, source: Source, body?: boolean) => Promise<void>
  ) {
    this.body = new BodyLibrary(
      context,
      () => {
        this.handle?.invalidate();
        this.notify();
      },
      error => this.report(error)
    );
  }

  private report(error: unknown) {
    if (!this.context.signal.aborted) {
      this.error = error instanceof Error ? error.message : String(error);
      this.notify();
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private notify() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  private enqueue(work: () => Promise<void>) {
    const task = this.pending.then(() => {
      this.context.signal.throwIfAborted();
      return work();
    });
    this.pending = task.catch(error => {
      this.report(error);
    });
    return task;
  }

  private async readableKinds() {
    if (!this.preferences.matchTitle && !this.preferences.headingLevels.length)
      return new Set<TargetKind>();
    const kinds = await Promise.all(
      this.preferences.targets.map(async kind =>
        (await this.context.permissions.query(`${kind}s:read`)) === "granted" ? kind : null
      )
    );
    return new Set(kinds.filter((kind): kind is TargetKind => kind !== null));
  }

  private async targetsFor(
    kind: TargetKind,
    row: PluginArticle | PluginDocument | null,
    preferences: Preferences
  ) {
    const owner = toTarget(kind, row);
    if (!row || !owner) return [];
    const targets: Target[] = preferences.matchTitle && owner.title ? [owner] : [];
    if (preferences.headingLevels.length && row.contentRef) {
      const body = await this.context.content.read(row.contentRef, { format: "nodes" });
      for (const heading of readHeadings(body?.nodes ?? [], preferences.headingLevels)) {
        targets.push({ ...owner, heading });
      }
    }
    return targets;
  }

  private async canReadBody() {
    return (
      this.preferences.matchBody &&
      (await this.context.permissions.query("cards:read")) === "granted"
    );
  }

  async sourcePassages(source: Source): Promise<Passage[]> {
    if (
      !this.preferences.sources.includes(source.kind) ||
      !(await this.canReadBody()) ||
      (await this.context.permissions.query(`${source.kind}s:read`)) !== "granted"
    )
      return [];
    const row = await this.context.data[
      source.kind === "card" ? "cards" : source.kind === "article" ? "articles" : "documents"
    ].get(source.id);
    if (!row?.contentRef) return [];
    const body = await this.context.content.read(row.contentRef, { format: "nodes" });
    return passagesOf(body?.nodes ?? []);
  }

  async bodyHits(
    source: Source,
    passages: Passage[] | string,
    signal?: AbortSignal
  ): Promise<BodyHit[]> {
    if (
      !(await this.canReadBody()) ||
      !this.preferences.sources.includes(source.kind) ||
      (await this.context.permissions.query(`${source.kind}s:read`)) !== "granted"
    )
      return [];
    if (typeof passages === "string")
      return this.body.index.hits(passages, source, this.preferences.wordBoundaries);
    const cards = new Map<string, BodyHit>();
    let sliceStarted = performance.now();
    for (const { text } of passages) {
      if (performance.now() - sliceStarted > 8) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        sliceStarted = performance.now();
      }
      if (signal?.aborted || this.context.signal.aborted || !this.preferences.matchBody) return [];
      for (const { phrase } of this.body.index.match(
        text,
        source,
        this.preferences.wordBoundaries
      )) {
        for (const hit of this.body.index.hits(phrase, source, this.preferences.wordBoundaries)) {
          const previous = cards.get(hit.id);
          if (!previous || hit.phrase.length > previous.phrase.length) cards.set(hit.id, hit);
        }
      }
    }
    return [...cards.values()].sort(
      (a, b) => b.phrase.length - a.phrase.length || b.createdAt - a.createdAt
    );
  }

  async openCard(hit: BodyHit) {
    if (!(await this.canReadBody())) throw new Error("请先开启卡片正文匹配并允许读取卡片。");
    const card = await this.context.data.cards.get(hit.id);
    if (!card || card.createdAt !== hit.createdAt) throw new Error("这张卡片已删除。");
    const body = await this.context.content.read(card.contentRef, { format: "nodes" });
    const passages = passagesOf(body?.nodes ?? []).filter(p => p.text.includes(hit.phrase));
    const current = passages.find(p => p.block === hit.block) ?? passages[0];
    if (!current) throw new Error("卡片中的这段文字已更改。");
    await this.context.app.open({ kind: "card", id: hit.id }, { at: { block: current.block } });
  }

  async candidates(title: string, source: Source) {
    const allowed = await this.readableKinds();
    return this.index.candidates(title, source, allowed);
  }

  async open(title: string, source: Source, selected?: Target) {
    const candidates = await this.candidates(title, source);
    if (!selected && candidates.length > 1) return this.choose(title, source);
    const chosen = selected ?? candidates[0];
    if (
      !chosen ||
      !candidates.some(
        item =>
          item.kind === chosen.kind && item.id === chosen.id && item.createdAt === chosen.createdAt
      )
    )
      throw new Error("这条标题已更改、被删除，或不在当前匹配范围内。");
    const ref = { kind: chosen.kind, id: chosen.id };
    const row = await reader(this.context, chosen.kind).get(chosen.id);
    if (!row || row.createdAt !== chosen.createdAt) throw new Error("目标已删除，请重新选择。");
    if (!chosen.heading) {
      if (!this.preferences.matchTitle || row.title.trim() !== title)
        throw new Error("内容标题已经变化，请重新选择。");
      return this.context.app.open(ref);
    }
    // 点击时用最新正文确定块序号，前面插入段落后仍能跳到小标题。
    const { heading } = chosen;
    const matches = (await this.targetsFor(chosen.kind, row, this.preferences)).flatMap(item =>
      item.heading?.level === heading.level && item.heading.text === title ? [item.heading] : []
    );
    const current = heading.nodeId
      ? matches.find(h => h.nodeId === heading.nodeId)
      : (matches.find(h => h.path === heading.path) ??
        (matches.length === 1 ? matches[0] : undefined));
    if (!current) throw new Error("小标题已移动、改名或删除，请重新选择。");
    await this.context.app.open(ref, { at: { block: current.block } });
  }

  rebuild() {
    return this.configure(undefined, false, true);
  }

  configure(requested?: Preferences, persist = true, force = false) {
    return this.enqueue(async () => {
      const next = requested ?? this.preferences;
      const api = this.context.textDecorations;
      if (!api) throw new Error("当前 Tau 未提供文字装饰能力，请使用支持 FakeLink 的桌面版本。");
      const needsIndex =
        !this.handle ||
        force ||
        next.targets.join() !== this.preferences.targets.join() ||
        next.matchTitle !== this.preferences.matchTitle ||
        next.headingLevels.join() !== this.preferences.headingLevels.join();
      const bodyChanged = next.matchBody !== this.preferences.matchBody;
      const needsRegistration =
        !this.handle || next.sources.join() !== this.preferences.sources.join();
      if (needsRegistration || needsIndex || (bodyChanged && next.matchBody)) {
        const kinds = new Set(next.sources);
        if (next.matchTitle || next.headingLevels.length)
          for (const kind of next.targets) kinds.add(kind);
        if (next.matchBody) kinds.add("card");
        if (
          !(await this.context.permissions.request(
            [...kinds].map(kind => `${kind}s:read` as const)
          ))
        )
          throw new Error("请在插件权限中允许读取所选内容，或在设置中缩小范围。");
      }
      let index = this.index;
      if (needsIndex) {
        index = new TitleIndex();
        for (const kind of next.matchTitle || next.headingLevels.length ? next.targets : []) {
          let cursor: string | undefined;
          do {
            this.context.signal.throwIfAborted();
            const page = await reader(this.context, kind).query({
              limit: 200,
              sort: "created",
              cursor,
            });
            for (const row of page.items) {
              this.context.signal.throwIfAborted();
              index.update({ kind, id: row.id }, await this.targetsFor(kind, row, next));
            }
            cursor = page.cursor;
          } while (cursor);
        }
      }
      this.context.signal.throwIfAborted();
      const handle = needsRegistration
        ? await api.register({
            sources: next.sources,
            getDecorations: async ({ source, text }, signal) => {
              const allowed = await this.readableKinds();
              if (signal.aborted) return [];
              const titles = this.index
                .match(
                  text,
                  source,
                  allowed,
                  this.preferences.appearance,
                  this.preferences.wordBoundaries
                )
                .map(hit => ({ ...hit, key: JSON.stringify(["title", hit.key]) }));
              if (!(await this.canReadBody()) || signal.aborted) return titles;
              const body = this.body.index.match(text, source, this.preferences.wordBoundaries);
              const titleCount = titles.length;
              let nextTitle = 0;
              for (const hit of body) {
                while (nextTitle < titleCount && titles[nextTitle].end <= hit.start) nextTitle++;
                if (nextTitle < titleCount && titles[nextTitle].start < hit.end) continue;
                titles.push({
                  start: hit.start,
                  end: hit.end,
                  key: JSON.stringify(["body", hit.phrase]),
                  appearance: this.preferences.appearance,
                });
              }
              return titles;
            },
            onActivate: async ({ key, source }) => {
              const [kind, term] = JSON.parse(key) as [string, string];
              if (kind === "title") return this.open(term, source);
              const hits = await this.bodyHits(source, term);
              if (!hits.length) throw new Error("匹配的卡片已变化。");
              if (hits.length === 1) return this.openCard(hits[0]);
              return this.choose(term, source, true);
            },
          })
        : undefined;
      try {
        if (persist) await this.context.storage.set("preferences", { ...next });
        this.context.signal.throwIfAborted();
      } catch (error) {
        await handle?.dispose();
        throw error;
      }
      const previous = this.handle;
      this.index = index;
      this.preferences = next;
      this.handle = handle ?? previous;
      if (next.matchBody && (bodyChanged || force || !previous)) this.body.start();
      else if (!next.matchBody && bodyChanged) this.body.stop();
      if (handle) await previous?.dispose();
      this.handle?.invalidate();
      this.error = "";
      this.notify();
    });
  }

  changed(event: PluginDomainEvent) {
    if (event.type === "workspace.reset") {
      this.index = new TitleIndex();
      this.body.stop();
      this.notify();
      this.handle?.invalidate();
      void this.rebuild().catch(() => {});
      return;
    }
    if (event.type.startsWith("card.")) {
      if (event.id && this.preferences.matchBody)
        void this.body.update(event.id).catch(error => this.report(error));
      return;
    }
    void this.enqueue(async () => {
      const kind = event.type.startsWith("article.") ? "article" : "document";
      if (
        !event.id ||
        (!this.preferences.matchTitle && !this.preferences.headingLevels.length) ||
        !this.preferences.targets.includes(kind)
      )
        return;
      // 事件是变更提示，重新读取可以处理事务回滚及同一编号的连续变化。
      const row = await reader(this.context, kind).get(event.id);
      this.context.signal.throwIfAborted();
      const targets = await this.targetsFor(kind, row, this.preferences);
      this.context.signal.throwIfAborted();
      if (this.index.update({ kind, id: event.id }, targets)) {
        this.handle?.invalidate();
        this.notify();
      }
    }).catch(() => {});
  }
}
