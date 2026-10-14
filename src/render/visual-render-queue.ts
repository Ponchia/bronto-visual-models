/** Own asynchronous renderer work until it settles, including disposal. */
export function createVisualRenderQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  return {
    run<T>(work: () => Promise<T>): Promise<T | undefined> {
      const next = tail.then(() => (closed ? undefined : work()));
      tail = next.catch(() => {});
      return next;
    },
    async idle() {
      await tail;
    },
    close(dispose: () => void) {
      closed = true;
      void tail.finally(dispose);
    },
  };
}
