import { discoverSources } from "../services/source-manager.js";
import { parseMediaRequest } from "../utils/validation.js";
export async function streamRoutes(app) {
  app.get("/api/v1/stream/movie/:id", async (request, reply) => {
    const media = parseMediaRequest({ type: "movie", ...request.params });
    return reply.code(200).send(await discoverSources(media));
  });
  app.get("/api/v1/stream/tv/:id/season/:season/episode/:episode", async (request, reply) => {
    const media = parseMediaRequest({ type: "tv", ...request.params });
    return reply.code(200).send(await discoverSources(media));
  });
}
