import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@tau/ui";
import type { BodyHit, Passage } from "./body-index";
import type { Source } from "./titles";
import type { FakeLink } from "./runtime";

export function BodyResults({
  runtime,
  source,
  input,
}: {
  runtime: FakeLink;
  source: Source;
  input: Passage[] | string;
}) {
  const version = useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  const [hits, setHits] = useState<BodyHit[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void runtime.bodyHits(source, input, controller.signal).then(
      rows => {
        if (!controller.signal.aborted) {
          setHits(rows);
          setError("");
        }
      },
      reason => {
        if (!controller.signal.aborted) {
          setHits([]);
          setError(String(reason));
        }
      }
    );
    return () => {
      controller.abort();
    };
  }, [version, runtime, input, source.kind, source.id]);
  if (!hits.length && !error && typeof input !== "string") return null;
  const limit = expanded || typeof input === "string" ? hits.length : 3;
  return (
    <section className="tau-fakelink tau-fakelink-related">
      <strong>{typeof input === "string" ? `提到「${input}」的卡片` : "相关卡片"}</strong>
      {error && <p role="alert">{error}</p>}
      {hits.slice(0, limit).map(hit => (
        <Button
          variant="ghost"
          key={hit.id}
          onClick={() => void runtime.openCard(hit).catch(reason => setError(String(reason)))}
        >
          <span>{hit.excerpt}</span>
          <small>
            {hit.phrase} · {new Date(hit.createdAt).toLocaleDateString()}
          </small>
        </Button>
      ))}
      {hits.length > limit && (
        <Button variant="ghost" onClick={() => setExpanded(true)}>
          查看全部 {hits.length} 张
        </Button>
      )}
      {typeof input === "string" && !hits.length && !error && <p>当前没有匹配的卡片。</p>}
    </section>
  );
}

function SavedMatches({ runtime, source }: { runtime: FakeLink; source: Source }) {
  const [passages, setPassages] = useState<Passage[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let generation = 0;
    const load = () => {
      const current = ++generation;
      void runtime.sourcePassages(source).then(
        result => {
          if (generation === current) {
            setPassages(result);
            setError("");
          }
        },
        reason => {
          if (generation === current) {
            setPassages([]);
            setError(String(reason));
          }
        }
      );
    };
    const events = runtime.context.events.on(
      [`${source.kind}.updated`, `${source.kind}.deleted`, "workspace.reset"],
      event => {
        if (event.type === "workspace.reset" || event.id === source.id) load();
      }
    );
    load();
    return () => {
      generation++;
      void events.dispose();
    };
  }, [runtime, source.kind, source.id]);
  return error ? (
    <p role="alert">{error}</p>
  ) : (
    <BodyResults runtime={runtime} input={passages} source={source} />
  );
}

export function RelatedCards({ runtime, source }: { runtime: FakeLink; source: Source }) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot);
  if (!runtime.preferences.matchBody || !runtime.preferences.sources.includes(source.kind))
    return null;
  return <SavedMatches runtime={runtime} source={source} />;
}
