import type { AdapterProps } from "@ponchia/visual-models/react";
import { modelTargets } from "@ponchia/visual-models";

declare global {
  interface Window {
    scorecardModuleEvaluated?: boolean;
  }
}
window.scorecardModuleEvaluated = true;

export default function Scorecard(props: AdapterProps) {
  const item = (props.model.content.items as Array<{ id: string; label: string }>)[0];
  const target = modelTargets(props.model, props.registry).find((t) => t.elementId === item.id);
  return (
    <section aria-label="Custom scorecard" data-testid="custom-scorecard">
      <p>
        {item.label} · revision {props.model.revision}
      </p>
      <button type="button" onClick={() => props.onSelect?.(target ?? null)}>
        Select score
      </button>
      <button
        type="button"
        disabled={!props.onEdit}
        onClick={() => {
          void props.onEdit?.({
            generation: props.model.generation,
            items: [
              {
                field: "items",
                set: [{ id: item.id, label: "Reviewed", expect: { label: item.label } }],
              },
            ],
          });
        }}
      >
        Review score
      </button>
      <output data-testid="score-selection">
        {props.selected?.elementId === item.id ? "selected" : "none"}
      </output>
    </section>
  );
}
