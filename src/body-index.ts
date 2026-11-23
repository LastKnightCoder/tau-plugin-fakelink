import type { Source } from "./titles";

export interface Passage {
  block: number;
  text: string;
}
export interface IndexedCard {
  id: string;
  createdAt: number;
  passages: Passage[];
}
export interface BodyHit {
  phrase: string;
  id: string;
  createdAt: number;
  block: number;
  excerpt: string;
}

// 保留普通正文与连续格式叶子，已有链接、代码和不同段落隔开匹配。
export function passagesOf(nodes: readonly unknown[]): Passage[] {
  const passages: Passage[] = [];
  function visit(node: unknown, block: number) {
    if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children))
      return;
    if (
      "type" in node &&
      ["code-block", "code-step", "link", "content-link", "inline-math", "block-math"].includes(
        String(node.type)
      )
    )
      return;
    let text = "";
    const flush = () => {
      for (const sentence of text.split(/[。！？!?；;\n]+/u)) {
        if (sentence.trim()) passages.push({ block, text: sentence.trim() });
      }
      text = "";
    };
    for (const child of node.children) {
      if (child && typeof child.text === "string" && !child.code) text += child.text;
      else {
        flush();
        visit(child, block);
      }
    }
    flush();
  }
  nodes.forEach(visit);
  return passages;
}

const runs = (text: string) => text.matchAll(/[\p{L}\p{N}]+(?: +[\p{L}\p{N}]+)*/gu);
const seeds = (text: string) => text.matchAll(/(?=([\p{L}\p{N} ]{4}))/gu);
const asciiWord = (char: string | undefined) => !!char && /[a-zA-Z0-9_]/.test(char);
// 高频锚点辨识度低；长段近似、重复数字等输入也要限制每次向两侧比较的长度。
const maxPostings = 32;
const maxPhraseUnits = 96;
const stop = new Set([
  "我觉得这个",
  "在这个时候",
  "在这个过程",
  "this",
  "that",
  "with",
  "from",
  "have",
  "some",
  "then",
  "when",
]);

interface Line {
  id: string;
  createdAt: number;
  passage: Passage;
  text: string;
}

export class BodyIndex {
  private postings = new Map<string, Set<Line>>();
  private cards = new Map<string, Line[]>();

  update(id: string, card: IndexedCard | null) {
    for (const line of this.cards.get(id) ?? []) {
      for (const [, seed] of seeds(line.text)) {
        const bucket = this.postings.get(seed);
        if (bucket?.delete(line) && !bucket.size) this.postings.delete(seed);
      }
    }
    this.cards.delete(id);
    if (!card) return;
    const lines: Line[] = [];
    for (const passage of card.passages) {
      for (const [text] of runs(passage.text)) {
        if (text.length < 4) continue;
        const line = { id: card.id, createdAt: card.createdAt, passage, text };
        lines.push(line);
        for (const [, seed] of seeds(text)) {
          let bucket = this.postings.get(seed);
          if (!bucket) {
            bucket = new Set();
            this.postings.set(seed, bucket);
          }
          bucket.add(line);
        }
      }
    }
    this.cards.set(id, lines);
  }

  private anchors(phrase: string) {
    let smallest: Set<Line> | undefined;
    for (const [, seed] of seeds(phrase)) {
      const bucket = this.postings.get(seed);
      if (!bucket) return undefined;
      if (!smallest || bucket.size < smallest.size) smallest = bucket;
    }
    return smallest && smallest.size <= maxPostings ? smallest : undefined;
  }

  hits(phrase: string, source: Source, wordBoundaries: boolean): BodyHit[] {
    const cards = new Map<string, BodyHit>();
    for (const line of this.anchors(phrase) ?? []) {
      const { id, createdAt, passage } = line;
      if (
        (source.kind === "card" && source.id === id) ||
        cards.has(id) ||
        !line.text.includes(phrase)
      )
        continue;
      let offset = line.text.indexOf(phrase);
      while (
        offset >= 0 &&
        wordBoundaries &&
        ((asciiWord(phrase[0]) && asciiWord(line.text[offset - 1])) ||
          (asciiWord(phrase[phrase.length - 1]) && asciiWord(line.text[offset + phrase.length])))
      )
        offset = line.text.indexOf(phrase, offset + 1);
      if (offset < 0) continue;
      const at = passage.text.indexOf(line.text) + offset;
      cards.set(id, {
        phrase,
        id,
        createdAt,
        block: passage.block,
        excerpt: passage.text.slice(Math.max(0, at - 35), at + phrase.length + 45),
      });
    }
    return [...cards.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  match(text: string, source: Source, words: boolean) {
    const ranges: { start: number; end: number; phrase: string }[] = [];
    for (const run of runs(text)) {
      const value = run[0];
      if (!/\p{L}/u.test(value)) continue;
      let used = 0;
      for (const match of seeds(value)) {
        const at = match.index!,
          seed = match[1];
        if (at < used || (words && asciiWord(value[at - 1]) && asciiWord(value[at]))) continue;
        const bucket = this.postings.get(seed);
        if (!bucket || bucket.size > maxPostings) continue;
        let bestStart = at,
          bestEnd = at;
        for (const line of bucket) {
          if (source.kind === "card" && source.id === line.id) continue;
          let pos = -1;
          // 重复模板或超长正文中的同一锚点只取前几处校验，限制一次渲染的开销。
          for (let count = 0; count < 8; count++) {
            pos = line.text.indexOf(seed, pos + 1);
            if (pos < 0) break;
            let left = at,
              right = at + seed.length,
              otherLeft = pos,
              otherRight = pos + seed.length;
            while (
              right - left < maxPhraseUnits &&
              left > used &&
              otherLeft > 0 &&
              value[left - 1] === line.text[otherLeft - 1]
            ) {
              left--;
              otherLeft--;
            }
            while (
              right - left < maxPhraseUnits &&
              right < value.length &&
              otherRight < line.text.length &&
              value[right] === line.text[otherRight]
            ) {
              right++;
              otherRight++;
            }
            while (
              left < right &&
              (value[left] === " " ||
                (words &&
                  asciiWord(value[left]) &&
                  (asciiWord(value[left - 1]) || asciiWord(line.text[otherLeft - 1]))))
            ) {
              left++;
              otherLeft++;
            }
            while (
              right > left &&
              (value[right - 1] === " " ||
                (words &&
                  asciiWord(value[right - 1]) &&
                  (asciiWord(value[right]) || asciiWord(line.text[otherRight]))))
            ) {
              right--;
              otherRight--;
            }
            if (right - left <= bestEnd - bestStart) continue;
            const phrase = value.slice(left, right);
            if (
              left > at ||
              right < at + seed.length ||
              /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(phrase) ||
              !/([\p{L}\p{N}][ ]*){4}/u.test(phrase) ||
              stop.has(phrase.toLowerCase()) ||
              !/\p{L}/u.test(phrase)
            )
              continue;
            bestStart = left;
            bestEnd = right;
          }
        }
        if (bestEnd > bestStart) {
          const phrase = value.slice(bestStart, bestEnd);
          ranges.push({ start: run.index! + bestStart, end: run.index! + bestEnd, phrase });
          used = bestEnd;
        }
      }
    }
    return ranges;
  }
}
