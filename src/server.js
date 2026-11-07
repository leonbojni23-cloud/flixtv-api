import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { warmupRoutes } from "./routes/warmup.js";
import { streamRoutes } from "./routes/stream.js";

const app = Fastify({ logger: { level: config.logLevel }, trustProxy: true, bodyLimit: 64 * 1024, requestTimeout: 15_000 });

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (config.allowedOrigins.includes(origin)) return callback(null, true);
    if (config.allowedOrigins.length === 0) return callback(null, false);
    return callback(new Error("Origin not allowed"), false);
  },
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

app.addHook("onRequest", async (request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Cache-Control", "no-store");
  if (!request.url.startsWith("/api/") || !config.apiSharedSecret) return;
  if (request.headers.authorization !== `Bearer ${config.apiSharedSecret}`) {
    return reply.code(401).send({ success: false, error: "Unauthorized" });
  }
});
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "Request failed");
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  reply.code(statusCode).send({ success: false, error: statusCode >= 500 ? "Internal server error" : error.message });
});
await app.register(healthRoutes);
await app.register(warmupRoutes);
await app.register(streamRoutes);
app.setNotFoundHandler((_request, reply) => reply.code(404).send({ success: false, error: "Route not found" }));
try { await app.listen({ host: config.host, port: config.port }); }
catch (error) { app.log.error(error); process.exit(1); }
