import { describe, expect, it, vi } from "vitest"
import {
  type GatewayRuntimeApp,
  type GatewayRuntimeDatabase,
  startGatewayRuntime,
} from "../src/runtime.js"

function createApp(listen: () => Promise<string>): GatewayRuntimeApp {
  return {
    close: vi.fn(async () => {}),
    listen,
    log: {
      error: vi.fn(),
      info: vi.fn(),
    },
  }
}

function createDatabase(): GatewayRuntimeDatabase {
  return { destroy: vi.fn(async () => {}) }
}

describe("startGatewayRuntime", () => {
  it("closes the app and database without starting the worker when listen fails", async () => {
    const app = createApp(async () => {
      throw new Error("port already in use")
    })
    const database = createDatabase()
    const startWorker = vi.fn(() => vi.fn(async () => {}))

    await expect(
      startGatewayRuntime({ app, database, host: "127.0.0.1", port: 8100, startWorker }),
    ).rejects.toThrow("port already in use")

    expect(startWorker).not.toHaveBeenCalled()
    expect(app.close).toHaveBeenCalledOnce()
    expect(database.destroy).toHaveBeenCalledOnce()
  })

  it("closes the listening app and database when worker startup fails", async () => {
    const app = createApp(async () => "http://127.0.0.1:8100")
    const database = createDatabase()
    const workerError = new Error("worker startup failed")

    await expect(
      startGatewayRuntime({
        app,
        database,
        host: "127.0.0.1",
        port: 8100,
        startWorker: () => {
          throw workerError
        },
      }),
    ).rejects.toBe(workerError)

    expect(app.close).toHaveBeenCalledOnce()
    expect(database.destroy).toHaveBeenCalledOnce()
  })
})
