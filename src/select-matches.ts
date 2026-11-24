import type { PluginTextDecoration } from "@tau/plugins";

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const generic = new Set(
  "使用 其他 其它 定义 实现 参考 输出 位置 项目 标准 例子 介绍 说明 总结 概述 简介 工作 例如 通常需要 顾名思义 除此之外 需要注意的是 默认情况下".split(
    " "
  )
);
const filler =
  /^(?:[的了而但及于与其]|这[个种些是]|那[个种些]|但是|如果|对于|为了|可以|至少|几乎|迟迟|一个|需要|可能|例如|往往|一般|就是|只有|我们|没有|有不同)|(?:[的了而与于]|一个|一些|可以|需要|不同|时候|情况|原因|部分|来|去)$/u;

/** 泛用标题须有明确归属；同名小节优先取段落中最近提到的笔记。 */
export function scopedTitles<T extends { title: string; heading?: unknown }>(
  term: string,
  targets: T[],
  before: string
) {
  const weak = generic.has(term) || /^\p{Script=Han}$/u.test(term);
  let nearest = -1;
  const named: T[] = [];
  for (const target of targets) {
    if (!target.heading || !target.title || target.title === term) continue;
    const at = before.lastIndexOf(target.title);
    if (at < 0 || at < nearest) continue;
    if (/[a-z0-9_]/i.test(target.title[0]) && /[a-z0-9_]/i.test(before[at - 1] ?? "")) continue;
    if (
      /[a-z0-9_]/i.test(target.title.slice(-1)) &&
      /[a-z0-9_]/i.test(before[at + target.title.length] ?? "")
    )
      continue;
    if (at > nearest) {
      named.length = 0;
      nearest = at;
    }
    named.push(target);
  }
  return named.length ? named : weak ? [] : targets;
}

export function selectMatches(
  text: string,
  candidates: readonly {
    hit: PluginTextDecoration;
    explicit: boolean;
    targets: number;
    support: number;
  }[]
) {
  if (!candidates.length) return [];
  const words = [...segmenter.segment(text)].filter(word => word.isWordLike);
  const starts = new Set(words.map(word => word.index));
  const ends = new Set(words.map(word => word.index + word.segment.length));
  const distinct = new Map<
    string,
    { hit: PluginTextDecoration; score: number; explicit: boolean; occurrences: number }
  >();
  for (const { hit, explicit: isTitle, targets: count, support } of candidates) {
    const term = text.slice(hit.start, hit.end);
    if (
      (/^\p{Script=Han}/u.test(term) && !starts.has(hit.start)) ||
      (/\p{Script=Han}$/u.test(term) && !ends.has(hit.end))
    )
      continue;
    if (!count || count > 10 || (!isTitle && (support <= 0 || term.length > 40))) continue;
    const length = [...term].length;
    const properName = /^[A-Za-z][A-Za-z0-9.+#-]*$/.test(term) && /[A-Z]/.test(term);
    const score =
      (isTitle ? 5 : 0) +
      Math.min(length, 12) +
      Math.min(support, 8) -
      (!isTitle && (generic.has(term) || filler.test(term)) ? 4 : 0) -
      Math.log2(count) +
      (properName ? 4 : 0);
    const previous = distinct.get(term);
    if (previous) {
      if (hit.start !== previous.hit.start) previous.occurrences++;
      if (
        (isTitle && !previous.explicit) ||
        (previous.explicit === isTitle && score > previous.score)
      ) {
        previous.hit = hit;
        previous.explicit = isTitle;
      }

      previous.score = Math.max(previous.score, score);
    } else distinct.set(term, { hit, score, explicit: isTitle, occurrences: 1 });
  }
  const priority = (candidate: { score: number; occurrences: number }) =>
    candidate.score + Math.min(2, candidate.occurrences - 1) * 2;
  const max = Math.min(3, 1 + Math.floor(text.length / 110));
  const selected: PluginTextDecoration[] = [];
  let covered = 0;
  for (const { hit } of [...distinct.values()].sort(
    (a, b) => priority(b) - priority(a) || a.hit.start - b.hit.start
  )) {
    if (text.length >= 40 && covered + hit.end - hit.start > text.length * 0.25) continue;
    if (selected.some(other => hit.start < other.end && other.start < hit.end)) continue;
    selected.push(hit);
    covered += hit.end - hit.start;
    if (selected.length === max) break;
  }
  return selected.sort((a, b) => a.start - b.start);
}
