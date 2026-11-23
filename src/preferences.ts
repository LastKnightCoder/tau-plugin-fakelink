import type { SourceKind, TargetKind, Appearance } from "./titles";
export interface Preferences {
  targets: TargetKind[];
  sources: SourceKind[];
  appearance: Appearance;
  wordBoundaries: boolean;
}
export const kinds = ["article", "document", "card"] as const;
export const labels = { article: "文章", document: "项目文档", card: "卡片" };
export const defaults: Preferences = {
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
  return {
    targets: targets.length ? targets : defaults.targets,
    sources: sources.length ? sources : defaults.sources,
    appearance: data.appearance === "highlight" ? "highlight" : "link",
    wordBoundaries: data.wordBoundaries !== false,
  };
}
