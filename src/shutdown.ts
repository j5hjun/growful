export interface CreateShutdownInput {
  scheduler: NodeJS.Timeout;
  close: () => void;
  onSignal?: (signal: NodeJS.Signals) => void;
}

export function createShutdown(input: CreateShutdownInput): (signal?: NodeJS.Signals) => void {
  let isShuttingDown = false;

  return (signal) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    clearInterval(input.scheduler);
    input.close();

    if (signal) {
      input.onSignal?.(signal);
    }
  };
}
