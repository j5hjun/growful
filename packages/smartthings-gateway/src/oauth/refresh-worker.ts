export interface RefreshService {
  refreshDueConnections(): Promise<{
    readonly failureNames: readonly string[]
    readonly refreshedCount: number
  }>
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

export function startRefreshWorker(options: RefreshWorkerOptions): () => Promise<void> {
  let activeRun: Promise<void> | undefined
  const execute = async (): Promise<void> => {
    try {
      const result = await options.service.refreshDueConnections()
      for (const errorName of result.failureNames) {
        options.logger.error({ errorName }, "token.refresh.failed")
      }
      if (result.refreshedCount > 0) {
        options.logger.info("token.refresh.completed")
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError"
      options.logger.error({ errorName }, "token.refresh.failed")
    }
  }
  const run = (): Promise<void> => {
    if (activeRun !== undefined) {
      return activeRun
    }
    activeRun = execute().finally(() => {
      activeRun = undefined
    })
    return activeRun
  }

  void run()
  const timer = setInterval(() => void run(), options.intervalMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await activeRun
  }
}
