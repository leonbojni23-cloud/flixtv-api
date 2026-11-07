export async function healthRoutes(app) {
  app.get("/health", async () => ({ success: true, status: "ok", service: "flixtv-api", timestamp: new Date().toISOString() }));
}
