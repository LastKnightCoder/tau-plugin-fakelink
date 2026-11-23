import type { SourceKind, TargetKind, Appearance } from "./titles";
import { headingLevels, type HeadingLevel } from "./headings";
export interface Preferences {
  matchTitle: boolean;
  matchBody: boolean;
  headingLevels: HeadingLevel[];
  targets: TargetKind[];
  sources: SourceKind[];
  appearance: Appearance;
  wordBoundaries: boolean;
}
export const kinds = ["article", "document", "card"] as const;
export const labels = { article: "文章", document: "项目文档", card: "卡片" };
export const defaults: Preferences = {
  matchTitle: true,
  matchBody: false,
  headingLevels: [],
  targets: ["article", "document"],
  sources: ["article", "document"],
  appearance: "link",
  wordBoundaries: true,
};

export function readPreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object") return defaults;
  const data = value as Partial<Preferences>;
  const targets = defaults.targets.filter(
    k => Array.isArray(data.targets) && data.targets.includes(k)
  );
  const sources = kinds.filter(k => Array.isArray(data.sources) && data.sources.includes(k));
  const levels = headingLevels.filter(
    level => Array.isArray(data.headingLevels) && data.headingLevels.includes(level)
  );
  return {
    matchTitle: data.matchTitle !== false || (!levels.length && data.matchBody !== true),
    matchBody: data.matchBody === true,
    headingLevels: levels,
    targets: targets.length ? targets : defaults.targets,
    sources: sources.length ? sources : defaults.sources,
    appearance: data.appearance === "highlight" ? "highlight" : "link",
    wordBoundaries: data.wordBoundaries !== false,
  };
}
