import type { SourceKind, TargetKind, Appearance } from "./titles";
import { headingLevels, type HeadingLevel } from "./headings";
export interface Preferences {
  matchTitle: boolean;
  matchBody: boolean;
  bodyTargets: SourceKind[];
  headingLevels: HeadingLevel[];
  targets: TargetKind[];
  sources: SourceKind[];
  appearance: Appearance;
  wordBoundaries: boolean;
}
export const kinds = ["article", "document", "card"] as const;
export const defaults: Preferences = {
  matchTitle: true,
  matchBody: false,
  bodyTargets: [...kinds],
  headingLevels: [],
  targets: ["article", "document"],
  sources: ["article", "document"],
  appearance: "reference",
  wordBoundaries: true,
};

export const appearances = ["reference", "ghost", "marker", "tint"] as const;
// 0.2 及更早版本保存的是 link / highlight。
const legacyAppearance: Record<string, Appearance> = { link: "reference", highlight: "marker" };
function readAppearance(value: unknown): Appearance {
  if (typeof value !== "string") return defaults.appearance;
  if (value in legacyAppearance) return legacyAppearance[value];
  return appearances.find(item => item === value) ?? defaults.appearance;
}

export function readPreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object") return defaults;
  const data = value as Partial<Preferences>;
  const targets = defaults.targets.filter(
    k => Array.isArray(data.targets) && data.targets.includes(k)
  );
  const sources = kinds.filter(k => Array.isArray(data.sources) && data.sources.includes(k));
  const bodyTargets = kinds.filter(
    kind => Array.isArray(data.bodyTargets) && data.bodyTargets.includes(kind)
  );
  const levels = headingLevels.filter(
    level => Array.isArray(data.headingLevels) && data.headingLevels.includes(level)
  );
  return {
    matchTitle: data.matchTitle !== false || (!levels.length && data.matchBody !== true),
    matchBody: data.matchBody === true,
    bodyTargets: bodyTargets.length ? bodyTargets : ["card"],
    headingLevels: levels,
    targets: targets.length ? targets : defaults.targets,
    sources: sources.length ? sources : defaults.sources,
    appearance: readAppearance(data.appearance),
    wordBoundaries: data.wordBoundaries !== false,
  };
}
