export interface RefreshService {
  refreshIfDue(): Promise<boolean>
}

export interface RefreshLogger {
  error(fields: { readonly errorName: string }, message: string): void
  info(message: string): void
}

export type RefreshWorkerOptions = {
  readonly intervalMs: number
  readonly logger: RefreshLogger
  readonly service: RefreshService
}

export async function runTokenRefresh(service: RefreshService): Promise<boolean> {
  return service.refreshIfDue()
}

export function startRefreshWorker(options: RefreshWorkerOptions): () => void {
  const run = async (): Promise<void> => {
    try {
      const refreshed = await runTokenRefresh(options.service)
      if (refreshed) {
        options.logger.info("token.refresh.completed")
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError"
      options.logger.error({ errorName }, "token.refresh.failed")
    }
  }

  void run()
  const timer = setInterval(() => void run(), options.intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
