export async function warmupRoutes(app) {
  app.get("/warmup", async () => ({ success: true, status: "ready", timestamp: new Date().toISOString() }));
}
