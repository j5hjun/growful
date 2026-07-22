import type { FastifyInstance } from "fastify"

const strictTransportSecurity = "max-age=63072000"

export function registerTransportSecurity(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.protocol === "https") {
      reply.header("Strict-Transport-Security", strictTransportSecurity)
    }
    return payload
  })
}
