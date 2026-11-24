import type { Source, SourceKind } from "./titles";

export interface Passage {
  block: number;
  text: string;
}
export interface IndexedBody {
  tags?: readonly string[];
  title: string;
  createdAt: number;
  passages: Passage[];
}
export interface BodyHit {
  support: number;
  kind: SourceKind;
  title: string;
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

const tokenizer = new Intl.Segmenter("zh", { granularity: "word" });
function words(text: string) {
  const distinct = new Set<string>();
  let previousSingle = "";
  for (const { segment, isWordLike } of tokenizer.segment(text)) {
    // 词典外的中文术语有时被切成连续单字，例如“缓存”；保留相邻字对作证据。
    const single = isWordLike && /^\p{Script=Han}$/u.test(segment);
    if (single && previousSingle) distinct.add(previousSingle + segment);
    previousSingle = single ? segment : "";
    if (!isWordLike || segment.length < 2 || !/\p{L}/u.test(segment)) continue;
    // 数量表达和句法助词即使在小库里少见，也不能独立说明主题。
    if (
      /^[零一二两三四五六七八九十几每这那某][个位种篇句项次条张些本处份]$/u.test(segment) ||
      /^[的了]/u.test(segment)
    )
      continue;
    distinct.add(segment.toLowerCase());
  }
  return distinct;
}

export function surroundingText(text: string, offset: number, phrase: string) {
  return text
    .slice(Math.max(0, offset - 48), offset + phrase.length + 48)
    .split(phrase)
    .join(" ");
}

interface Line {
  tagWords: ReadonlySet<string>;
  start: number;
  kind: SourceKind;
  title: string;
  id: string;
  createdAt: number;
  passage: Passage;
  text: string;
}

type Postings = Map<string, Line | Line[]>;

// 高频按不同笔记计，每篇都分到一次校验机会；同一篇的重复段落均匀取样。
function* sample(bucket: Postings | undefined) {
  if (!bucket || bucket.size > maxPostings) return;
  const limit = Math.floor(maxPostings / bucket.size);
  for (const entry of bucket.values()) {
    if (!Array.isArray(entry)) yield entry;
    else {
      const count = Math.min(limit, entry.length);
      for (let i = 0; i < count; i++) yield entry[Math.floor((i * entry.length) / count)];
    }
  }
}

export class BodyIndex {
  private postings = new Map<string, Postings>();
  private entries = new Map<string, { seeds: Set<string>; words: Set<string> }>();
  private frequencies = {
    card: new Map<string, number>(),
    article: new Map<string, number>(),
    document: new Map<string, number>(),
  };
  private documents = { card: 0, article: 0, document: 0 };

  update(ref: Source, body: IndexedBody | null) {
    const key = ref.kind + ":" + ref.id;
    const previous = this.entries.get(key);
    const frequency = this.frequencies[ref.kind];
    if (previous) {
      this.documents[ref.kind]--;
      for (const word of previous.words) {
        const remaining = frequency.get(word)! - 1;
        if (remaining) frequency.set(word, remaining);
        else frequency.delete(word);
      }
    }
    for (const seed of previous?.seeds ?? []) {
      const bucket = this.postings.get(seed);
      if (bucket?.delete(key) && !bucket.size) this.postings.delete(seed);
    }
    this.entries.delete(key);
    if (!body) return;
    const indexedSeeds = new Set<string>();
    const tagWords = words((body.tags ?? []).join(" "));
    for (const passage of body.passages) {
      for (const run of runs(passage.text)) {
        const text = run[0];
        if (text.length < 4) continue;
        const line = {
          tagWords,
          start: run.index!,
          ...ref,
          title: body.title,
          createdAt: body.createdAt,
          passage,
          text,
        };

        for (const [, seed] of seeds(text)) {
          let bucket = this.postings.get(seed);
          if (!bucket) {
            bucket = new Map();
            this.postings.set(seed, bucket);
          }
          indexedSeeds.add(seed);
          const old = bucket.get(key);
          if (!old) bucket.set(key, line);
          else if (Array.isArray(old)) {
            if (old.at(-1) !== line) old.push(line);
          } else if (old !== line) bucket.set(key, [old, line]);
        }
      }
    }
    const vocabulary = new Set(tagWords);
    for (const passage of body.passages)
      for (const word of words(passage.text)) vocabulary.add(word);
    for (const word of vocabulary) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    this.documents[ref.kind]++;
    this.entries.set(key, { seeds: indexedSeeds, words: vocabulary });
  }

  private anchors(phrase: string) {
    let smallest: Postings | undefined;
    for (const [, seed] of seeds(phrase)) {
      const bucket = this.postings.get(seed);
      if (!bucket) return undefined;
      if (!smallest || bucket.size < smallest.size) smallest = bucket;
    }
    return smallest && smallest.size <= maxPostings ? smallest : undefined;
  }

  hits(
    phrase: string,
    source: Source,
    wordBoundaries: boolean,
    allowed: ReadonlySet<SourceKind>,
    context: string
  ): BodyHit[] {
    const weights = new Map<string, number>();
    const size = [...allowed].reduce((sum, kind) => sum + this.documents[kind], 0);
    const phraseWords = words(phrase);
    const idf = (word: string) => {
      let df = 0;
      for (const kind of allowed) df += this.frequencies[kind].get(word) ?? 0;
      return Math.log2(1 + (size + 1) / (df + 1));
    };
    let sourceWeight = 0;
    for (const word of words(context)) {
      if (phraseWords.has(word)) continue;
      const weight = idf(word);
      weights.set(word, weight);
      sourceWeight += weight;
    }
    if (!weights.size) return [];
    // 一项约在 1/8 文档中出现的词，或两项较弱证据即可；小库仍允许重复主题形成连接。
    const threshold = Math.log2(1 + (size + 1) / (Math.max(2, size / 8) + 1));
    const targets = new Map<string, BodyHit>();
    for (const line of sample(this.anchors(phrase))) {
      const { kind, id, title, createdAt, passage } = line;
      const key = kind + ":" + id;
      if (
        !allowed.has(kind) ||
        (source.kind === kind && source.id === id) ||
        !line.text.includes(phrase)
      )
        continue;
      let offset = -1;
      for (let occurrence = 0; occurrence < 8; occurrence++) {
        offset = line.text.indexOf(phrase, offset + 1);
        if (offset < 0) break;
        if (
          wordBoundaries &&
          ((asciiWord(phrase[0]) && asciiWord(line.text[offset - 1])) ||
            (asciiWord(phrase[phrase.length - 1]) && asciiWord(line.text[offset + phrase.length])))
        )
          continue;
        const at = line.start + offset;
        const evidence = words(surroundingText(passage.text, at, phrase));
        for (const word of line.tagWords) evidence.add(word);
        let targetWeight = 0,
          commonWeight = 0,
          first = 0,
          second = 0;
        for (const word of evidence) {
          if (phraseWords.has(word)) continue;
          const weight = weights.get(word);
          targetWeight += weight ?? idf(word);
          if (weight === undefined) continue;
          commonWeight += weight;
          if (weight > first) {
            second = first;
            first = weight;
          } else second = Math.max(second, weight);
        }
        // 长段落偶然共享一个少见词仍可能跨题，同时衡量共同证据在两边上下文中的占比。
        const coverage = commonWeight / Math.sqrt(sourceWeight * targetWeight || 1);
        const namedTopic = [...line.tagWords].some(word => (weights.get(word) ?? 0) >= threshold);
        if (coverage < 0.1 && !namedTopic) continue;
        const support = first + 0.5 * second;
        if (support < threshold || (targets.get(key)?.support ?? 0) >= support) continue;
        targets.set(key, {
          kind,
          title,
          phrase,
          id,
          createdAt,
          block: passage.block,
          support,
          excerpt: passage.text.slice(Math.max(0, at - 35), at + phrase.length + 45),
        });
      }
    }
    return [...targets.values()].sort((a, b) => b.support - a.support || b.createdAt - a.createdAt);
  }

  match(text: string, source: Source, words: boolean, allowed: ReadonlySet<SourceKind>) {
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
        for (const line of sample(bucket)) {
          if (!allowed.has(line.kind) || (source.kind === line.kind && source.id === line.id))
            continue;
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
