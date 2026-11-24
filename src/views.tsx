import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Switch } from "@tau/ui";
import { headingLevels } from "./headings";
import { appearances, defaults, kinds, labels, type Preferences } from "./preferences";
import type { FakeLink } from "./runtime";
import type { Appearance } from "./titles";

const looks: Record<Appearance, { name: string; hint: string }> = {
  reference: { name: "引用", hint: "正文色文字加点线" },
  ghost: { name: "隐形", hint: "悬停或按住 ⌘ 才显出" },
  marker: { name: "荧光笔", hint: "文字下沿淡色底" },
  tint: { name: "着色", hint: "只改字色" },
};

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="tau-fakelink-group">
      <h3>{title}</h3>
      {hint && <p className="tau-fakelink-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Chip({
  on,
  locked,
  onToggle,
  children,
}: {
  on: boolean;
  locked?: boolean;
  onToggle(next: boolean): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tau-fakelink-chip"
      aria-pressed={on}
      disabled={locked}
      title={locked ? "至少保留一项" : undefined}
      onClick={() => onToggle(!on)}
    >
      {children}
    </button>
  );
}

export function Settings({ runtime }: { runtime: FakeLink }) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  // 保存中的目标偏好：configure 可能要重建完索引才更新 runtime.preferences，期间先按目标显示。
  const [request, setRequest] = useState<Preferences | null>(null);
  const preferences = request ?? runtime.preferences;
  async function save(next: Preferences) {
    setRequest(next);
    try {
      await runtime.configure(next);
    } catch {
      /* runtime.error 供设置页显示 */
    } finally {
      // 期间又有新点击时保留最新请求，界面不回退。
      setRequest(current => (current === next ? null : current));
    }
  }
  function toggle<K>(options: readonly K[], selected: readonly K[], item: K, on: boolean) {
    return options.filter(option => (option === item ? on : selected.includes(option)));
  }
  // 内容标题、小标题、正文短语至少保留一种。
  const matchers = Number(preferences.matchTitle) + preferences.headingLevels.length + Number(preferences.matchBody);

  return (
    <fieldset className="tau-fakelink" aria-busy={request !== null}>
      <Group title="显示方式" hint="识别出的标题在正文里怎么显示，不会改动原文。">
        <div className="tau-fakelink-looks" role="radiogroup" aria-label="显示方式">
          {appearances.map(id => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={preferences.appearance === id}
              className="tau-fakelink-look"
              onClick={() => void save({ ...preferences, appearance: id })}
            >
              <span className="tau-fakelink-preview">
                去读 <span data-tau-decoration={id}>遗忘曲线</span>
              </span>
              <span className="tau-fakelink-look-name">
                {looks[id].name}
                {id === defaults.appearance && <small>推荐</small>}
              </span>
              <span className="tau-fakelink-look-hint">{looks[id].hint}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="从哪里收录标题">
        <div className="tau-fakelink-chips">
          {defaults.targets.map(kind => (
            <Chip
              key={kind}
              on={preferences.targets.includes(kind)}
              locked={preferences.targets.length === 1 && preferences.targets[0] === kind}
              onToggle={on =>
                void save({ ...preferences, targets: toggle(defaults.targets, preferences.targets, kind, on) })
              }
            >
              {labels[kind]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="从哪里收录正文">
        <div className="tau-fakelink-chips">
          {kinds.map(kind => (
            <Chip
              key={kind}
              on={preferences.bodyTargets.includes(kind)}
              locked={preferences.bodyTargets.length === 1 && preferences.bodyTargets[0] === kind}
              onToggle={on =>
                void save({ ...preferences, bodyTargets: toggle(kinds, preferences.bodyTargets, kind, on) })
              }
            >
              {labels[kind]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="在哪些正文显示">
        <div className="tau-fakelink-chips">
          {kinds.map(kind => (
            <Chip
              key={kind}
              on={preferences.sources.includes(kind)}
              locked={preferences.sources.length === 1 && preferences.sources[0] === kind}
              onToggle={on =>
                void save({ ...preferences, sources: toggle(kinds, preferences.sources, kind, on) })
              }
            >
              {labels[kind]}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title="匹配什么" hint="小标题匹配以淡色显示，点击跳到对应小节。">
        <div className="tau-fakelink-chips">
          <Chip
            on={preferences.matchTitle}
            locked={preferences.matchTitle && matchers === 1}
            onToggle={on => void save({ ...preferences, matchTitle: on })}
          >
            内容标题
          </Chip>
          <span className="tau-fakelink-divider" aria-hidden />
          {headingLevels.map(level => {
            const on = preferences.headingLevels.includes(level);
            return (
              <Chip
                key={level}
                on={on}
                locked={on && matchers === 1}
                onToggle={next =>
                  void save({
                    ...preferences,
                    headingLevels: toggle(headingLevels, preferences.headingLevels, level, next),
                  })
                }
              >
                H{level}
              </Chip>
            );
          })}
        </div>
        <div className="tau-fakelink-row">
          <div>
            <div>正文短语</div>
            <p className="tau-fakelink-hint">标出与已收录内容共有的连续短语。</p>
          </div>
          <Switch
            checked={preferences.matchBody}
            disabled={preferences.matchBody && matchers === 1}
            aria-label="正文短语"
            onCheckedChange={enabled =>
              void save({
                ...preferences,
                matchBody: enabled,
              })
            }
          />
        </div>
        <div className="tau-fakelink-row">
          <div>
            <div>英文和数字只匹配完整单词</div>
            <p className="tau-fakelink-hint">关闭后，「API」也会在「myAPI」里被识别。</p>
          </div>
          <Switch
            checked={preferences.wordBoundaries}
            aria-label="英文和数字只匹配完整单词"
            onCheckedChange={on => void save({ ...preferences, wordBoundaries: on })}
          />
        </div>
      </Group>

      {runtime.error && (
        <div role="alert" className="tau-fakelink-error">
          <span>{runtime.error}</span>
          <Button
            size="sm"
            disabled={request !== null}
            onClick={() => void runtime.rebuild().catch(() => {})}
          >
            重新建立索引
          </Button>
        </div>
      )}
    </fieldset>
  );
}
