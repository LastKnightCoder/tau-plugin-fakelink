import test from "node:test";
import assert from "node:assert/strict";
import { BodyIndex, passagesOf } from "../src/body-index.ts";

const ref = id => ({ kind: "card", id });
const allowed = new Set(["card"]);

test("无标题卡片共享完整短语时给出原句、真实块位置，编辑删除后清理，自己不参与", () => {
  const idx = new BodyIndex(),
    source = { kind: "card", id: "new" };
  const put = (id, text) =>
    idx.update(ref(id), { title: "", createdAt: 12, passages: [{ block: 3, text }] });
  put("old", "我今天试了一次主动回忆，合上书才发现忘了。");
  put("new", "准备把主动回忆用在面试上");
  assert.deepEqual(idx.match("📝准备用主动回忆做练习", source, true, allowed), [
    { start: 5, end: 9, phrase: "主动回忆" },
  ]);
  assert.deepEqual(
    idx.hits("主动回忆", source, true, allowed).map(h => [h.id, h.block, h.excerpt]),
    [["old", 3, "我今天试了一次主动回忆，合上书才发现忘了。"]]
  );
  put("old", "新内容中删除了旧说法");
  assert.deepEqual(idx.match("主动回忆", source, true, allowed), []);
  put("old", "主动回忆");
  idx.update(ref("old"), null);
  assert.deepEqual(idx.hits("主动回忆", source, true, allowed), []);
});
test("格式叶子连起来，段落、标点、代码与链接隔开短语", () => {
  const nodes = [
    {
      type: "paragraph",
      children: [
        { text: "主动" },
        { text: "回忆", bold: true },
        { text: "不收录", code: true },
        { text: "间隔" },
        { type: "link", children: [{ text: "链接文字" }] },
        { text: "重复。另一句" },
      ],
    },
  ];
  assert.deepEqual(
    passagesOf(nodes).map(p => p.text),
    ["主动回忆", "间隔", "重复", "另一句"]
  );
});
test("英文不取词内片段，常见短词与到处重复的文本不产生关联", () => {
  const idx = new BodyIndex(),
    source = { kind: "document", id: "x" };
  idx.update(ref("a"), {
    title: "",
    createdAt: 1,
    passages: [
      { block: 0, text: "pineapple pie" },
      { block: 0, text: "我觉得这个" },
    ],
  });
  assert.deepEqual(idx.match("apple", source, true, allowed), []);
  assert.deepEqual(idx.match("我觉得这个", source, true, allowed), []);
  for (let i = 0; i < 40; i++)
    idx.update(ref(String(i)), {
      title: "",
      createdAt: 1,
      passages: [{ block: 0, text: "通用模板" }],
    });
  assert.deepEqual(idx.match("通用模板", source, true, allowed), []);
});

test("不同类型共用编号时独立更新，并按来源和授权范围排除候选", () => {
  const index = new BodyIndex();
  for (const kind of ["card", "article", "document"])
    index.update(
      { kind, id: "1" },
      { title: "", createdAt: 1, passages: [{ block: 2, text: "共同内容片段" }] }
    );
  const source = { kind: "article", id: "1" };
  const permitted = new Set(["article", "document"]);
  assert.deepEqual(
    index.hits("共同内容片段", source, true, permitted).map(hit => hit.kind),
    ["document"]
  );
  index.update({ kind: "document", id: "1" }, null);
  assert.deepEqual(index.match("共同内容片段", source, true, permitted), []);
  assert.deepEqual(
    index.hits("共同内容片段", source, true, new Set(["card"])).map(hit => hit.kind),
    ["card"]
  );
});
