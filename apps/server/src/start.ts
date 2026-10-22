import type { FastifyInstance } from "fastify";
import { createApp, type AppOptions } from "./app.js";
import { HOST } from "./config.js";
import type { ServerDeps } from "./deps.js";
import { failure, ok, type Result } from "./ports.js";

export type RunningServer = {
  readonly app: FastifyInstance;
  readonly url: string;
  readonly port: number;
  readonly close: () => Promise<void>;
};

/**
 * Starts the server on loopback.
 *
 * `HOST` is passed rather than read from anywhere, and the bound address is read back out of the
 * server afterwards: the test that asserts "this is not reachable from the network" asserts it
 * against the socket, not against the intention.
 */
export async function startServer(
  deps: ServerDeps,
  options: AppOptions & { readonly port: number },
): Promise<Result<RunningServer>> {
  const app = createApp(deps, options);

  try {
    await app.listen({ host: HOST, port: options.port });
  } catch (cause) {
    await app.close();

    return failure(
      "config_invalid",
      `Could not start the local server on ${HOST}:${String(options.port)}. Another program may be using that port.`,
      cause,
    );
  }

  const address = app.addresses()[0];
  if (address === undefined) {
    await app.close();

    return failure("config_invalid", "The local server started but is not listening anywhere.");
  }

  return ok({
    app,
    url: `http://${HOST}:${String(address.port)}`,
    port: address.port,
    close: async () => {
      await app.close();
    },
  });
}
