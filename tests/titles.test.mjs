import test from "node:test";
import assert from "node:assert/strict";
import { TitleIndex } from "../src/titles.ts";

test("同名目标排除自身，较长标题退役后能匹配剩下的短标题", () => {
  const index = new TitleIndex(),
    source = { kind: "article", id: "1" },
    allowed = new Set(["article", "document"]);
  const put = (kind, id, title) => {
    const row = { kind, id, title, createdAt: 1, tags: [] };
    index.update(row, row);
  };
  put("article", "1", "间隔");
  put("document", "1", "间隔");
  put("article", "2", "间隔重复");
  const match = () => index.match("📝间隔重复", source, allowed, "link", true);
  assert.deepEqual(match(), [{ start: 2, end: 6, appearance: "link", key: "间隔重复" }]);
  put("article", "2", "复习");
  assert.deepEqual(
    match().map(x => x.key),
    ["间隔"]
  );
  assert.deepEqual(
    index.candidates("间隔", source, allowed).map(x => x.kind),
    ["document"]
  );
  index.update({ kind: "document", id: "1" }, null);
  assert.deepEqual(match(), []);
});
test("英文单词边界可以关闭，来源范围也适用于候选查找", () => {
  const index = new TitleIndex(),
    target = { kind: "article", id: "1", title: "API", createdAt: 1, tags: [] };
  index.update(target, target);
  const source = { kind: "card", id: "1" };
  const match = (allowed, words) =>
    index.match("myAPI API文", source, new Set(allowed), "highlight", words).map(x => x.start);
  assert.deepEqual(match(["article"], true), [6]);
  assert.deepEqual(match(["article"], false), [2, 6]);
  assert.deepEqual(match(["document"], false), []);
});
