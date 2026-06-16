import type { SchedulerHandle } from "./scheduler.js";

export interface CreateShutdownInput {
  scheduler: SchedulerHandle;
  close: () => void | Promise<void>;
  onSignal?: (signal: NodeJS.Signals) => void;
}

export function createShutdown(input: CreateShutdownInput): (signal?: NodeJS.Signals) => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return async (signal) => {
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        await input.scheduler.stop();
        await input.close();
      })();
    }

    await shutdownPromise;

    if (signal) {
      input.onSignal?.(signal);
    }
  };
}
