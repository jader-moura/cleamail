import Fastify, { type FastifyInstance } from "fastify";
import { ALLOWED_HOSTNAMES, DEFAULT_PORT } from "./config.js";
import { registerRoutes } from "./routes.js";
import { registerWeb } from "./web.js";
import type { ServerDeps } from "./deps.js";

export type AppOptions = {
  /**
   * The port the server is expected to be reachable on, for the `Host` check.
   *
   * Only used before the socket exists, which is what `inject` does in tests. Once the server is
   * listening, the bound port is the truth: `listen` may have been given 0 and handed a port by the
   * operating system, and a check against the number that was asked for would refuse every real
   * request.
   */
  readonly port?: number;
  /** Off by default so tests are quiet. `main.ts` turns it on. */
  readonly logRequests?: boolean;
  /**
   * The built dashboard to serve from the same origin.
   *
   * Left out, the API answers on its own and `/` says the app has not been built. That is a normal
   * state during development and not worth failing a startup over.
   */
  readonly webDir?: string;
};

/**
 * The local API.
 *
 * Built as a function of its dependencies so the whole thing can be exercised with
 * `app.inject()` against an in-memory store and a fake mailbox, with no socket and no network.
 */
export function createApp(deps: ServerDeps, options: AppOptions = {}): FastifyInstance {
  const port = options.port ?? DEFAULT_PORT;

  const app = Fastify({
    // The access log holds method, path, status and duration. A path may carry an email id, which
    // is allowed; nothing writes a subject, a sender or a reason into a log line.
    logger: options.logRequests === true ? { level: "info" } : false,
    // Nothing here accepts an upload, and a mail tool has no reason to read a megabyte of JSON.
    bodyLimit: 64 * 1024,
  });

  /**
   * The one attack a loopback server actually faces.
   *
   * Binding 127.0.0.1 stops other machines, but not a page the user is visiting: that page can
   * point its own hostname at 127.0.0.1 and talk to this server from the browser, with the
   * browser happily sending the request. The `Host` header is the only thing that tells the two
   * apart, so a request that did not address this server by a loopback name is refused.
   */
  app.addHook("onRequest", (request, reply, done) => {
    const host = request.headers.host ?? "";
    const hostname = host.includes(":") ? host.slice(0, host.lastIndexOf(":")) : host;
    const requestPort = host.includes(":") ? host.slice(host.lastIndexOf(":") + 1) : "";
    const ourPort = app.addresses()[0]?.port ?? port;

    const addressed =
      ALLOWED_HOSTNAMES.includes(hostname) &&
      (requestPort === "" || requestPort === String(ourPort));

    if (!addressed) {
      void reply.code(403).send({
        error: {
          code: "not_allowed",
          message: "cleamail only answers requests addressed to it on this machine.",
        },
      });

      return;
    }

    done();
  });

  registerRoutes(app, deps);
  registerWeb(app, options.webDir);

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      error: { code: "not_found", message: `No route for ${request.method} ${request.url}.` },
    });
  });

  return app;
}
