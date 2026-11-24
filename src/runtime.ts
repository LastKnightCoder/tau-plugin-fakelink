import { scopedTitles, selectMatches } from "./select-matches";
import { BodyLibrary, bodyReader } from "./body-library";
import { surroundingText, passagesOf, type BodyHit } from "./body-index";
import { readHeadings } from "./headings";
import type {
  PluginContext,
  PluginDomainEvent,
  PluginTextDecorationHandle,
  PluginEntityReader,
  PluginArticle,
  PluginDocument,
  PluginTextDecoration,
  PluginTextDecorationCandidate,
  PluginTextDecorationActivation,
  PluginDecorationPreviewTarget,
} from "@tau/plugins";
import { TitleIndex, type Source, type Target, type TargetKind } from "./titles";
import { labels, type Preferences } from "./preferences";

const reader = (
  context: PluginContext,
  kind: TargetKind
): PluginEntityReader<PluginArticle | PluginDocument> =>
  kind === "article" ? context.data.articles : context.data.documents;

function toTarget(kind: TargetKind, row: PluginArticle | PluginDocument | null): Target | null {
  if (!row || ("kind" in row && !row.contentRef)) return null;
  return { kind, id: row.id, title: row.title.trim(), tags: row.tags, createdAt: row.createdAt };
}

const targetKey = (target: Target) =>
  JSON.stringify([target.kind, target.id, target.createdAt, target.heading?.path ?? null]);

function candidateOf(target: Target): PluginTextDecorationCandidate {
  const where = target.heading
    ? `${labels[target.kind]}《${target.title || "无标题"}》· H${target.heading.level}`
    : labels[target.kind];
  return {
    key: targetKey(target),
    title: target.heading?.text ?? (target.title || "无标题"),
    description: [
      where,
      ...target.tags.map(tag => "#" + tag),
      new Date(target.createdAt).toLocaleDateString(),
    ].join(" · "),
  };
}

// 只匹配到小标题时用淡色，和内容标题区分开。
function describe(title: string, targets: readonly Target[]) {
  const tone = targets.length && targets.every(target => target.heading) ? "muted" : undefined;
  if (targets.length !== 1)
    return { tone, label: `${targets.length} 个同名内容，点击选择` } as const;
  const [target] = targets;
  const label = target.heading
    ? `跳到${labels[target.kind]}《${target.title || "无标题"}》的「${title}」`
    : `打开${labels[target.kind]}《${title}》`;
  return { tone, label } as const;
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
    public preferences: Preferences
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

  private async readableBodyKinds() {
    const allowed = new Set<Source["kind"]>();
    if (this.preferences.matchBody)
      await Promise.all(
        this.preferences.bodyTargets.map(async kind => {
          if ((await this.context.permissions.query(`${kind}s:read`)) === "granted")
            allowed.add(kind);
        })
      );
    return allowed;
  }

  async bodyHits(source: Source, phrase: string, around: string): Promise<BodyHit[]> {
    if (
      !this.preferences.matchBody ||
      !this.preferences.sources.includes(source.kind) ||
      (await this.context.permissions.query(`${source.kind}s:read`)) !== "granted"
    )
      return [];
    return this.body.index.hits(
      phrase,
      source,
      this.preferences.wordBoundaries,
      await this.readableBodyKinds(),
      around
    );
  }

  async openBody(hit: BodyHit) {
    if (!(await this.readableBodyKinds()).has(hit.kind))
      throw new Error("目标内容不在已授权的正文收录范围内。");
    const row = await bodyReader(this.context, hit.kind).get(hit.id);
    if (!row?.contentRef || row.createdAt !== hit.createdAt) throw new Error("目标内容已删除。");
    const body = await this.context.content.read(row.contentRef, { format: "nodes" });
    const passages = passagesOf(body?.nodes ?? []).filter(p => p.text.includes(hit.phrase));
    const current = passages.find(p => p.block === hit.block) ?? passages[0];
    if (!current) throw new Error("目标中的这段文字已更改。");
    await this.context.app.open({ kind: hit.kind, id: hit.id }, { at: { block: current.block } });
  }

  async candidates(title: string, source: Source) {
    const allowed = await this.readableKinds();
    return this.index.candidates(title, source, allowed);
  }

  private async options({ key, source }: PluginTextDecorationActivation) {
    const [kind, term, around] = JSON.parse(key) as [string, string, string];
    if (kind === "title") {
      return scopedTitles(term, await this.candidates(term, source), around).map(target => ({
        candidate: candidateOf(target),
        target: {
          ref: { kind: target.kind, id: target.id },
          ...(target.heading ? { at: { block: target.heading.block } } : {}),
        } satisfies PluginDecorationPreviewTarget,
        open: () => this.openTitle(term, target),
      }));
    }
    return (await this.bodyHits(source, term, around)).map(hit => ({
      candidate: {
        key: JSON.stringify([hit.kind, hit.id, hit.createdAt]),
        title: hit.title || labels[hit.kind],
        description: `${labels[hit.kind]} · ${hit.excerpt}`,
      },
      target: {
        ref: { kind: hit.kind, id: hit.id },
        at: { block: hit.block },
      } satisfies PluginDecorationPreviewTarget,
      open: () => this.openBody(hit),
    }));
  }

  private async openTitle(title: string, chosen: Target) {
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
      const bodyChanged =
        next.matchBody !== this.preferences.matchBody ||
        next.bodyTargets.join() !== this.preferences.bodyTargets.join();
      const needsRegistration =
        !this.handle || next.sources.join() !== this.preferences.sources.join();
      if (needsRegistration || needsIndex || (bodyChanged && next.matchBody)) {
        const kinds = new Set(next.sources);
        if (next.matchTitle || next.headingLevels.length)
          for (const kind of next.targets) kinds.add(kind);
        if (next.matchBody) for (const kind of next.bodyTargets) kinds.add(kind);
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
              const candidates = this.index
                .match(
                  text,
                  source,
                  allowed,
                  this.preferences.appearance,
                  this.preferences.wordBoundaries
                )
                .map(hit => {
                  const before = text.slice(Math.max(0, hit.start - 160), hit.start);
                  const targets = scopedTitles(
                    hit.key,
                    this.index.candidates(hit.key, source, allowed),
                    before
                  );
                  const decoration: PluginTextDecoration = {
                    ...hit,
                    ...describe(hit.key, targets),
                    key: JSON.stringify(["title", hit.key, before]),
                  };
                  return {
                    hit: decoration,
                    explicit: true,
                    targets: targets.length,
                    support: 0,
                  };
                });
              const allowedBodies = await this.readableBodyKinds();
              if (signal.aborted) return [];
              if (!allowedBodies.size) return selectMatches(text, candidates);
              const body = this.body.index.match(
                text,
                source,
                this.preferences.wordBoundaries,
                allowedBodies
              );
              for (const hit of body) {
                const around = surroundingText(text, hit.start, hit.phrase);
                const matches = this.body.index.hits(
                  hit.phrase,
                  source,
                  this.preferences.wordBoundaries,
                  allowedBodies,
                  around
                );
                const count = matches.length;
                if (!count) continue;
                candidates.push({
                  explicit: false,
                  targets: count,
                  support: matches[0].support,
                  hit: {
                    start: hit.start,
                    end: hit.end,
                    key: JSON.stringify(["body", hit.phrase, around]),
                    appearance: this.preferences.appearance,
                    label:
                      count > 1
                        ? `匹配到 ${count} 处内容，点击选择`
                        : `预览「${hit.phrase}」所在的段落`,
                  },
                });
              }
              return selectMatches(text, candidates);
            },
            getPreview: async (action, signal) => {
              const options = await this.options(action);
              if (signal.aborted) return;
              const selected =
                action.choice === undefined
                  ? options.length === 1
                    ? options[0]
                    : undefined
                  : options.find(item => item.candidate.key === action.choice);
              return selected?.target;
            },
            onActivate: async action => {
              const options = await this.options(action);
              if (action.choice === undefined && options.length > 1)
                return options.map(item => item.candidate);
              const selected =
                action.choice === undefined
                  ? options[0]
                  : options.find(item => item.candidate.key === action.choice);
              if (!selected) throw new Error("匹配的内容已变化，请重新选择。");
              await selected.open();
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
      if (next.matchBody && (bodyChanged || force || !previous)) this.body.start(next.bodyTargets);
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
    const kind = event.type.startsWith("card.")
      ? "card"
      : event.type.startsWith("article.")
        ? "article"
        : "document";
    if (event.id && this.preferences.matchBody && this.preferences.bodyTargets.includes(kind))
      void this.body.update(kind, event.id).catch(error => this.report(error));
    if (kind === "card") return;
    void this.enqueue(async () => {
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
