import { useId, useMemo, useState } from "react";
import { modelTargets, resolveModelTarget, targetResolves } from "../targets.ts";
import type { AdapterProps } from "./types.ts";

const PAGE_SIZE = 50;
/** Paginated semantic alternative: data is read only, and selections keep canonical identity. */
export default function ModelDataView(props: AdapterProps) {
  const filterId = useId();
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const targets = useMemo(
    () => modelTargets(props.model, props.registry),
    [props.model, props.registry],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return targets.filter(
      (target) =>
        !needle ||
        `${target.label} ${target.collection} ${target.elementId}`
          .toLocaleLowerCase()
          .includes(needle),
    );
  }, [targets, query]);
  const first = Math.min(
    offset,
    Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1) * PAGE_SIZE,
  );
  const visible = filtered.slice(first, first + PAGE_SIZE);
  return (
    <div
      className="bvm-data"
      role="region"
      aria-label={`${props.model.title} model data`}
      tabIndex={0}
    >
      <label htmlFor={filterId}>Filter model elements</label>
      <input
        id={filterId}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOffset(0);
        }}
      />
      <p role="status">
        {filtered.length
          ? `${first + 1}–${first + visible.length} of ${filtered.length} elements`
          : "No matching identified elements."}
      </p>
      <table>
        <caption>{props.model.title}: identified model elements</caption>
        <thead>
          <tr>
            <th scope="col">Element</th>
            <th scope="col">Collection</th>
            <th scope="col">Stored fields</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((target) => {
            const resolution = resolveModelTarget(props.model, target, undefined, props.registry);
            return (
              <tr key={`${target.collection}:${target.elementId}`}>
                <th scope="row">
                  <button
                    type="button"
                    disabled={!props.onSelect}
                    onClick={() => props.onSelect?.(target)}
                    aria-pressed={
                      props.selected?.collection === target.collection &&
                      props.selected?.elementId === target.elementId
                    }
                  >
                    {target.label}
                  </button>
                </th>
                <td>
                  {target.collection}
                  <br />
                  <code>{target.elementId}</code>
                </td>
                <td>
                  <details>
                    <summary>Inspect fields for {target.elementId}</summary>
                    <pre>
                      {targetResolves(resolution)
                        ? JSON.stringify(resolution.record, null, 2)
                        : resolution.reason}
                    </pre>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bvm-data-pages" role="group" aria-label="Model data pages">
        <button type="button" disabled={first === 0} onClick={() => setOffset(first - PAGE_SIZE)}>
          Previous elements
        </button>
        <button
          type="button"
          disabled={first + PAGE_SIZE >= filtered.length}
          onClick={() => setOffset(first + PAGE_SIZE)}
        >
          Next elements
        </button>
      </div>
      <p>This table reads identified records. It does not load datasets or external assets.</p>
    </div>
  );
}
