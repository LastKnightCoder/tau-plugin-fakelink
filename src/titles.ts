export type TargetKind = "article" | "document";
export type SourceKind = TargetKind | "card";
export type Source = { kind: SourceKind; id: string };
export type Target = {
  kind: TargetKind;
  id: string;
  title: string;
  tags: string[];
  createdAt: number;
};
export type Appearance = "link" | "highlight";

interface Branch {
  next: Map<string, Branch>;
  targets: Map<string, Target>;
}
const branch = (): Branch => ({ next: new Map(), targets: new Map() });
const identity = (ref: Source) => ref.kind + ":" + ref.id;

export class TitleIndex {
  private root = branch();
  private entries = new Map<string, Target>();

  update(ref: Source, target: Target | null) {
    const id = identity(ref);
    const previous = this.entries.get(id);
    if (!previous && !target) return false;
    if (
      previous &&
      target &&
      previous.title === target.title &&
      previous.createdAt === target.createdAt &&
      previous.tags.length === target.tags.length &&
      previous.tags.every((tag, i) => tag === target.tags[i])
    )
      return false;
    if (previous) {
      let node = this.root;
      const path: [Branch, string][] = [];
      for (let i = 0; i < previous.title.length; i++) {
        const char = previous.title[i];
        path.push([node, char]);
        node = node.next.get(char)!;
      }
      node.targets.delete(id);
      for (const [parent, char] of path.reverse()) {
        if (node.targets.size || node.next.size) break;
        parent.next.delete(char);
        node = parent;
      }
      this.entries.delete(id);
    }
    if (target) {
      let node = this.root;
      for (let i = 0; i < target.title.length; i++) {
        const char = target.title[i];
        if (!node.next.has(char)) node.next.set(char, branch());
        node = node.next.get(char)!;
      }
      node.targets.set(id, target);
      this.entries.set(id, target);
    }
    return true;
  }

  candidates(title: string, source: Source, allowed: ReadonlySet<TargetKind>) {
    let node = this.root;
    for (let i = 0; i < title.length; i++) {
      const child = node.next.get(title[i]);
      if (!child) return [];
      node = child;
    }
    return [...node.targets.values()].filter(
      target => allowed.has(target.kind) && identity(target) !== identity(source)
    );
  }

  match(
    text: string,
    source: Source,
    allowed: ReadonlySet<TargetKind>,
    appearance: Appearance,
    wordBoundaries: boolean
  ) {
    const ranges: { start: number; end: number; appearance: Appearance; key: string }[] = [];
    const self = identity(source);
    const isWord = (char: string | undefined) => !!char && /[a-zA-Z0-9_]/.test(char);
    for (let start = 0; start < text.length;) {
      let node = this.root;
      let longest = start;
      for (let end = start; end < text.length; end++) {
        const child = node.next.get(text[end]);
        if (!child) break;
        node = child;
        if (!node.targets.size) continue;
        if (
          wordBoundaries &&
          ((isWord(text[start]) && isWord(text[start - 1])) ||
            (isWord(text[end]) && isWord(text[end + 1])))
        )
          continue;
        for (const [id, target] of node.targets) {
          if (id !== self && allowed.has(target.kind)) {
            longest = end + 1;
            break;
          }
        }
      }
      if (longest === start) {
        start++;
        continue;
      }
      ranges.push({ start, end: longest, key: text.slice(start, longest), appearance });
      start = longest;
    }
    return ranges;
  }
}
