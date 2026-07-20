export interface GatewayRuntimeApp {
  readonly log: {
    error(fields: { readonly errorName: string; readonly step: string }, message: string): void
    info(fields: { readonly signal: NodeJS.Signals }, message: string): void
  }
  close(): Promise<void>
  listen(options: { readonly host: string; readonly port: number }): Promise<string>
}

export interface GatewayRuntimeDatabase {
  destroy(): Promise<void>
}

export type StopRefreshWorker = () => Promise<void>

export type GatewayRuntimeOptions = {
  readonly app: GatewayRuntimeApp
  readonly database: GatewayRuntimeDatabase
  readonly host: string
  readonly port: number
  readonly startWorker: () => StopRefreshWorker
}

type CleanupStep = "app" | "database" | "refresh-worker"

type CleanupFailure = {
  readonly errorName: string
  readonly step: CleanupStep
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError"
}

async function closeResources(
  app: GatewayRuntimeApp,
  database: GatewayRuntimeDatabase,
  stopWorker: StopRefreshWorker | undefined,
): Promise<readonly CleanupFailure[]> {
  const failures: CleanupFailure[] = []
  const close = async (step: CleanupStep, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation()
    } catch (error) {
      failures.push({ errorName: errorName(error), step })
    }
  }

  if (stopWorker !== undefined) {
    await close("refresh-worker", stopWorker)
  }
  await close("app", () => app.close())
  await close("database", () => database.destroy())
  return failures
}

export async function startGatewayRuntime(options: GatewayRuntimeOptions): Promise<void> {
  let stopWorker: StopRefreshWorker | undefined
  try {
    await options.app.listen({ host: options.host, port: options.port })
    stopWorker = options.startWorker()
  } catch (error) {
    const failures = await closeResources(options.app, options.database, stopWorker)
    for (const failure of failures) {
      options.app.log.error(failure, "server.startup.cleanup.failed")
    }
    throw error
  }

  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    options.app.log.info({ signal }, "server.stopping")
    const failures = await closeResources(options.app, options.database, stopWorker)
    for (const failure of failures) {
      options.app.log.error(failure, "server.shutdown.step.failed")
    }
    if (failures.length > 0) {
      process.exitCode = 1
    }
  }

  process.once("SIGINT", (signal) => void shutdown(signal))
  process.once("SIGTERM", (signal) => void shutdown(signal))
}
