import { useEffect, useRef, useState } from "react";
import { c4LayoutCandidate, type C4LayoutOptions, type C4LayoutProposal } from "../layout/c4.ts";
import type { VisualModel } from "../model.ts";
import type { C4Routing } from "../render/c4-routing.ts";
import type { AdapterProps } from "./types.ts";

type State = {
  key: string;
  phase: "idle" | "running" | "preview" | "applying";
  message?: string;
  proposal?: C4LayoutProposal;
  candidate?: VisualModel;
};
/** A proposal is local presentation. Only explicit Apply calls the host's existing commit boundary. */
export function useC4Layout(props: AdapterProps, viewId: string | undefined, otherWrite: boolean) {
  const { model } = props;
  const key = JSON.stringify([model.id, model.generation, model.revision, viewId]);
  const editable = props.active !== false && !!props.onEdit && model.role === "model";
  const [state, setState] = useState<State>({ key, phase: "idle" });
  const [routing, setRouting] = useState<C4Routing>();
  const controller = useRef<AbortController | null>(null),
    ticket = useRef(0),
    mounted = useRef(false);
  const writing = useRef(false);
  const latest = useRef({ props, key, viewId, editable, otherWrite });
  latest.current = { props, key, viewId, editable, otherWrite };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ticket.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    setState((old) => ({
      key,
      phase: "idle",
      ...(old.key !== key && old.proposal
        ? { message: "Architecture changed; the previous layout preview was discarded." }
        : {}),
    }));
    return () => {
      ticket.current++;
      controller.current?.abort();
      controller.current = null;
    };
  }, [key, editable, props.c4Layout]);
  const current = editable && state.key === key ? state : { key, phase: "idle" as const };
  const cancel = () => {
    ticket.current++;
    controller.current?.abort();
    controller.current = null;
    if (mounted.current)
      setState({
        key: latest.current.key,
        phase: "idle",
        message: "Layout cancelled; nothing was saved.",
      });
  };
  const request = async (options: C4LayoutOptions) => {
    const owner = latest.current,
      runner = owner.props.c4Layout;
    if (
      !owner.editable ||
      !runner ||
      !owner.viewId ||
      owner.otherWrite ||
      writing.current ||
      controller.current
    )
      return;
    const source = structuredClone(owner.props.model),
      registry = owner.props.registry,
      view = owner.viewId;
    const abort = new AbortController(),
      id = ++ticket.current;
    controller.current = abort;
    setState({ key: owner.key, phase: "running" });
    const owns = () =>
      mounted.current &&
      ticket.current === id &&
      latest.current.key === owner.key &&
      latest.current.editable &&
      latest.current.props.c4Layout === runner;
    try {
      const raw = await runner(structuredClone(source), view, { ...options }, abort.signal);
      if (!owns() || abort.signal.aborted) return;
      const candidate = c4LayoutCandidate(source, raw, registry);
      if (raw.viewId !== view) throw new Error("Layout returned a different architecture diagram");
      const proposal = structuredClone(raw);
      setState({ key: owner.key, phase: "preview", candidate, proposal });
    } catch (error) {
      if (owns() && !abort.signal.aborted)
        setState({
          key: owner.key,
          phase: "idle",
          message:
            error instanceof Error
              ? error.message
              : "Layout could not complete; nothing was saved.",
        });
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  };
  const apply = async () => {
    const owner = latest.current;
    if (
      !owner.editable ||
      !owner.props.onEdit ||
      owner.otherWrite ||
      writing.current ||
      current.phase !== "preview" ||
      !current.proposal ||
      current.key !== owner.key
    )
      return;
    const proposal = current.proposal;
    writing.current = true;
    setState({ ...current, phase: "applying" });
    const sameSurface = () =>
      mounted.current &&
      latest.current.editable &&
      latest.current.props.model.id === owner.props.model.id &&
      latest.current.props.model.generation === owner.props.model.generation &&
      latest.current.viewId === owner.viewId;
    try {
      c4LayoutCandidate(owner.props.model, proposal, owner.props.registry);
      await owner.props.onEdit(structuredClone(proposal.patch));
      if (sameSurface()) {
        setRouting(proposal.routing);
        setState({
          key: latest.current.key,
          phase: "idle",
          message: "Layout returned by host; the supplied model remains authoritative.",
        });
      }
    } catch (error) {
      if (sameSurface())
        setState({
          key: latest.current.key,
          phase: "idle",
          message:
            error instanceof Error
              ? error.message
              : "Layout was not confirmed; inspect host state before trying again.",
        });
    } finally {
      writing.current = false;
    }
  };
  return {
    phase: current.phase,
    preview: current.candidate,
    proposal: current.proposal,
    message: current.message,
    routing,
    locked: current.phase !== "idle",
    request,
    apply,
    cancel,
    discard: () => {
      if (writing.current) return;
      ticket.current++;
      controller.current?.abort();
      controller.current = null;
      setState({ key, phase: "idle", message: "Layout preview discarded; nothing was saved." });
    },
  };
}
