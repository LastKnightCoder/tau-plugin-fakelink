import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@tau/ui";
import type { PluginPageProps } from "@tau/plugins";
import { defaults, kinds, labels, type Preferences } from "./preferences";
import type { FakeLink } from "./runtime";
import type { Target } from "./titles";

export function Settings({ runtime }: { runtime: FakeLink }) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  const [saving, setSaving] = useState(false);
  const preferences = runtime.preferences;
  async function save(next: Preferences) {
    setSaving(true);
    try {
      await runtime.configure(next);
    } catch {
      /* runtime.error 供设置页显示 */
    } finally {
      setSaving(false);
    }
  }
  function choices<K extends keyof typeof labels>(
    title: string,
    options: readonly K[],
    selected: readonly K[],
    apply: (items: K[]) => Preferences
  ) {
    return (
      <fieldset disabled={saving}>
        <legend>{title}</legend>
        {options.map(kind => (
          <label key={kind}>
            <input
              type="checkbox"
              checked={selected.includes(kind)}
              disabled={selected.includes(kind) && selected.length === 1}
              onChange={event =>
                void save(
                  apply(
                    options.filter(item =>
                      item === kind ? event.target.checked : selected.includes(item)
                    )
                  )
                )
              }
            />
            {labels[kind]}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <div className="tau-fakelink">
      {choices("从哪里收录标题", defaults.targets, preferences.targets, targets => ({
        ...preferences,
        targets,
      }))}
      {choices("在哪些正文显示", kinds, preferences.sources, sources => ({
        ...preferences,
        sources,
      }))}
      <label>
        链接外观{" "}
        <select
          value={preferences.appearance}
          disabled={saving}
          onChange={e =>
            void save({
              ...preferences,
              appearance: e.target.value === "highlight" ? "highlight" : "link",
            })
          }
        >
          <option value="link">点状下划线</option>
          <option value="highlight">背景高亮</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={preferences.wordBoundaries}
          disabled={saving}
          onChange={e => void save({ ...preferences, wordBoundaries: e.target.checked })}
        />
        英文和数字只匹配完整单词
      </label>
      {runtime.error && (
        <div role="alert">
          {runtime.error}{" "}
          <Button disabled={saving} onClick={() => void runtime.rebuild().catch(() => {})}>
            重新读取标题
          </Button>
        </div>
      )}
    </div>
  );
}

export function Candidates({
  runtime,
  params,
}: {
  runtime: FakeLink;
  params: PluginPageProps["params"];
}) {
  const version = useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  const title = String(params.title ?? "");
  const kind = params.kind === "document" || params.kind === "card" ? params.kind : "article";
  const id = String(params.id ?? "");
  const [rows, setRows] = useState<Target[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setRows(null);
    setError("");
    void runtime.candidates(title, { kind, id }).then(
      result => {
        if (current) setRows(result);
      },
      reason => {
        if (current) setError(String(reason));
      }
    );
    return () => {
      current = false;
    };
  }, [runtime, version, title, kind, id]);
  return (
    <section className="tau-fakelink tau-fakelink-candidates">
      <h2>{title}</h2>
      {error && <p role="alert">{error}</p>}
      {rows === null && !error && <p role="status">正在读取同名内容…</p>}
      {rows?.length === 0 && <p>当前范围内已没有这个标题。</p>}
      {rows?.map(row => (
        <Button
          key={row.kind + ":" + row.id}
          variant="ghost"
          onClick={() =>
            void runtime.open(title, { kind, id }, row).catch(reason => setError(String(reason)))
          }
        >
          <span>
            {labels[row.kind]} · {row.title}
          </span>
          <small>
            {[
              ...row.tags.map(tag => "#" + tag),
              new Date(row.createdAt).toLocaleString(),
              row.id,
            ].join(" · ")}
          </small>
        </Button>
      ))}
    </section>
  );
}
