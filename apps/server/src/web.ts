import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Serving the dashboard.
 *
 * Same origin as the API on purpose: that is what keeps the `Host` check and the absence of CORS
 * meaningful. A dashboard on another port would need CORS, and a local API that answers other
 * origins is a local API any page can read.
 *
 * `@fastify/static` rather than a handler of our own, because serving files by path is how
 * directory traversal bugs get written, and this one is maintained by the people who wrote the
 * server.
 */

/** Where the built app lives, relative to this file once compiled into `dist`. */
function builtWebDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
}

export function resolveWebDir(
  env: Readonly<Record<string, string | undefined>> = {},
): string | undefined {
  const override = env["CLEAMAIL_WEB_DIR"];
  const candidate = override === undefined || override.trim() === "" ? builtWebDir() : override;

  // Missing is a normal state: the API is useful on its own, and a developer who has not built the
  // app yet should get a sentence rather than a crash on startup.
  return existsSync(join(candidate, "index.html")) ? candidate : undefined;
}

export function registerWeb(app: FastifyInstance, dir: string | undefined): void {
  if (dir === undefined) {
    app.get("/", (_request, reply) =>
      reply
        .code(503)
        .type("text/plain; charset=utf-8")
        .send(
          "The cleamail dashboard has not been built yet. Run `pnpm build` and start this again.\n",
        ),
    );

    return;
  }

  void app.register(fastifyStatic, {
    root: dir,
    // No directory listing, no dotfiles, and nothing outside the root. The app is a page and its
    // assets; anything else being reachable would be a mistake, not a feature.
    index: ["index.html"],
    list: false,
    dotfiles: "deny",
    serveDotFiles: false,
    cacheControl: true,
    maxAge: 0,
  });
}
