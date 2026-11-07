const splitCsv = (value = "") => value.split(",").map((item) => item.trim()).filter(Boolean);
export const config = Object.freeze({
  host: process.env.HOST || "0.0.0.0",
  port: Number.parseInt(process.env.PORT || "3000", 10),
  logLevel: process.env.LOG_LEVEL || "info",
  apiSharedSecret: process.env.API_SHARED_SECRET || "",
  allowedOrigins: splitCsv(process.env.ALLOWED_ORIGINS),
  cinesrcEnabled: process.env.CINESRC_ENABLED === "true",
  cinesrcBaseUrl: process.env.CINESRC_BASE_URL || "",
  cinesrcApiKey: process.env.CINESRC_API_KEY || ""
});
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("PORT must be a valid TCP port");
