export const headingLevels = [1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof headingLevels)[number];

export interface Heading {
  level: HeadingLevel;
  text: string;
  path: string;
  block: number;
  nodeId?: string;
}

function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if ("text" in node && typeof node.text === "string") return node.text;
  return "children" in node && Array.isArray(node.children)
    ? node.children.map(textOf).join("")
    : "";
}

export function readHeadings(
  nodes: readonly unknown[],
  levels: readonly HeadingLevel[]
): Heading[] {
  const result: Heading[] = [];
  function visit(value: unknown, path: string, block: number) {
    if (
      !value ||
      typeof value !== "object" ||
      !("children" in value) ||
      !Array.isArray(value.children)
    )
      return;
    if ("type" in value && value.type === "header") {
      const level = levels.find(level => "level" in value && level === value.level);
      if (level !== undefined) {
        const text = textOf(value).trim();
        if (text)
          result.push({
            level,
            text,
            path,
            block,
            nodeId:
              "collabId" in value && typeof value.collabId === "string"
                ? value.collabId
                : undefined,
          });
      }
      return;
    }
    value.children.forEach((child, i) => visit(child, path + "." + i, block));
  }
  nodes.forEach((node, i) => visit(node, String(i), i));
  return result;
}
