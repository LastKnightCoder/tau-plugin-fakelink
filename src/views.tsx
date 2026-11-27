import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Switch } from "@tau/ui";
import { useI18n } from "@tau/plugins";
import { headingLevels } from "./headings";
import { appearances, defaults, kinds, type Preferences } from "./preferences";
import { messages } from "./i18n";
import type { FakeLink } from "./runtime";
import type { Appearance } from "./titles";

const lookKeys = {
  reference: { name: "looks.reference.name", hint: "looks.reference.hint" },
  ghost: { name: "looks.ghost.name", hint: "looks.ghost.hint" },
  marker: { name: "looks.marker.name", hint: "looks.marker.hint" },
  tint: { name: "looks.tint.name", hint: "looks.tint.hint" },
} as const satisfies Record<Appearance, { name: string; hint: string }>;
const kindKeys = { article: "kind.article", document: "kind.document", card: "kind.card" } as const;

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
  const { t } = useI18n(messages);
  return (
    <button
      type="button"
      className="tau-fakelink-chip"
      aria-pressed={on}
      disabled={locked}
      title={locked ? t("chip.keepAtLeastOne") : undefined}
      onClick={() => onToggle(!on)}
    >
      {children}
    </button>
  );
}

export function Settings({ runtime }: { runtime: FakeLink }) {
  const { t } = useI18n(messages);
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
      <Group title={t("group.appearance.title")} hint={t("group.appearance.hint")}>
        <div className="tau-fakelink-looks" role="radiogroup" aria-label={t("group.appearance.title")}>
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
                {t("looks.samplePrefix")}
                <span data-tau-decoration={id}>{t("looks.sampleWord")}</span>
              </span>
              <span className="tau-fakelink-look-name">
                {t(lookKeys[id].name)}
                {id === defaults.appearance && <small>{t("looks.recommended")}</small>}
              </span>
              <span className="tau-fakelink-look-hint">{t(lookKeys[id].hint)}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title={t("group.targets.title")}>
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
              {t(kindKeys[kind])}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title={t("group.body.title")}>
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
              {t(kindKeys[kind])}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title={t("group.sources.title")}>
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
              {t(kindKeys[kind])}
            </Chip>
          ))}
        </div>
      </Group>

      <Group title={t("group.match.title")} hint={t("group.match.hint")}>
        <div className="tau-fakelink-chips">
          <Chip
            on={preferences.matchTitle}
            locked={preferences.matchTitle && matchers === 1}
            onToggle={on => void save({ ...preferences, matchTitle: on })}
          >
            {t("match.contentTitle")}
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
            <div>{t("match.bodyPhrase")}</div>
            <p className="tau-fakelink-hint">{t("match.bodyPhrase.hint")}</p>
          </div>
          <Switch
            checked={preferences.matchBody}
            disabled={preferences.matchBody && matchers === 1}
            aria-label={t("match.bodyPhrase")}
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
            <div>{t("match.wordBoundaries")}</div>
            <p className="tau-fakelink-hint">{t("match.wordBoundaries.hint")}</p>
          </div>
          <Switch
            checked={preferences.wordBoundaries}
            aria-label={t("match.wordBoundaries")}
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
            {t("settings.retry")}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
