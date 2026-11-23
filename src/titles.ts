import type { Heading } from "./headings";
export type TargetKind = "article" | "document";
export type SourceKind = TargetKind | "card";
export type Source = { kind: SourceKind; id: string };
export type Target = {
  kind: TargetKind;
  id: string;
  title: string;
  heading?: Heading;
  tags: string[];
  createdAt: number;
};
export type Appearance = "reference" | "ghost" | "marker" | "tint";

interface Branch {
  next: Map<string, Branch>;
  targets: Set<Target>;
}
const branch = (): Branch => ({ next: new Map(), targets: new Set() });
const identity = (ref: Source) => ref.kind + ":" + ref.id;

export class TitleIndex {
  private root = branch();
  private entries = new Map<string, Target[]>();

  update(ref: Source, targets: Target[]) {
    const id = identity(ref);
    const previous = this.entries.get(id) ?? [];
    if (
      previous.length === targets.length &&
      previous.every((row, i) => {
        const next = targets[i];
        return (
          row.title === next.title &&
          row.createdAt === next.createdAt &&
          row.heading?.text === next.heading?.text &&
          row.heading?.level === next.heading?.level &&
          row.heading?.path === next.heading?.path &&
          row.heading?.nodeId === next.heading?.nodeId &&
          row.tags.length === next.tags.length &&
          row.tags.every((tag, j) => tag === next.tags[j])
        );
      })
    )
      return false;

    for (const target of previous) {
      let node = this.root;
      const path: [Branch, string][] = [];
      const term = target.heading?.text ?? target.title;
      for (let i = 0; i < term.length; i++) {
        const char = term[i];
        path.push([node, char]);
        node = node.next.get(char)!;
      }
      node.targets.delete(target);
      for (const [parent, char] of path.reverse()) {
        if (node.targets.size || node.next.size) break;
        parent.next.delete(char);
        node = parent;
      }
    }
    for (const target of targets) {
      const term = target.heading?.text ?? target.title;
      let node = this.root;
      for (let i = 0; i < term.length; i++) {
        const char = term[i];
        if (!node.next.has(char)) node.next.set(char, branch());
        node = node.next.get(char)!;
      }
      node.targets.add(target);
    }
    if (targets.length) this.entries.set(id, targets);
    else this.entries.delete(id);
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
        for (const target of node.targets) {
          if (identity(target) !== self && allowed.has(target.kind)) {
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
