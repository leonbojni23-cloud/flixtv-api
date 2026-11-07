import { discoverSources } from "../services/source-manager.js";
import { parseMediaRequest } from "../utils/validation.js";
export async function streamRoutes(app) {
  app.get("/api/v1/stream/:type/:id", async (request, reply) => {
    const media = parseMediaRequest({ ...request.params, ...request.query });
    return reply.code(200).send(await discoverSources(media, { signal: request.signal }));
  });
  app.get("/api/v1/stream/tv/:id/season/:season/episode/:episode", async (request, reply) => {
    const media = parseMediaRequest({ type: "tv", ...request.params });
    return reply.code(200).send(await discoverSources(media, { signal: request.signal }));
  });
}
