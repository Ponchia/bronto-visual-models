/**
 * The cycles in a set of relations, as the component each cyclic item belongs
 * to. Two items share a component exactly when each reaches the other, so a
 * relation lies on a cycle when both of its ends map to the same component.
 * Relations naming an unknown item are ignored; absence is a separate issue.
 */
export function cycleComponents(
  ids: readonly string[],
  relations: readonly (readonly [string, string])[],
): Map<string, number> {
  const next = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [from, to] of relations) if (next.has(to)) next.get(from)?.push(to);
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const open = new Set<string>();
  const cyclic = new Map<string, number>();
  let components = 0;
  const visit = (id: string) => {
    order.set(id, order.size);
    low.set(id, order.get(id) ?? 0);
    stack.push(id);
    open.add(id);
    for (const to of next.get(id) ?? []) {
      if (!order.has(to)) {
        visit(to);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(to) ?? 0));
      } else if (open.has(to)) low.set(id, Math.min(low.get(id) ?? 0, order.get(to) ?? 0));
    }
    if (low.get(id) !== order.get(id)) return;
    const members: string[] = [];
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      open.delete(member);
      members.push(member);
      if (member === id) break;
    }
    if (members.length > 1 || next.get(id)?.includes(id)) {
      for (const member of members) cyclic.set(member, components);
      components++;
    }
  };
  for (const id of ids) if (!order.has(id)) visit(id);
  return cyclic;
}
