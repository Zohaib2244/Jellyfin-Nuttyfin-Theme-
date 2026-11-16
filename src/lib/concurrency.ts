/** Bound optional metadata work so artwork and primary page requests can use the connection too. */
export function limitConcurrency(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Concurrency must be a positive integer');
  let active = 0;
  const waiting: Array<() => void> = [];
  return <T>(task: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    const run = (): void => {
      active++;
      void Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active--;
        waiting.shift()?.();
      });
    };
    if (active < limit) run(); else waiting.push(run);
  });
}
