export function parsePositiveInteger(value, field, { max = 1_000_000 } = {}) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) {
    const error = new Error(`Invalid ${field}`);
    error.statusCode = 400;
    throw error;
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    const error = new Error(`Invalid ${field}`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}
export function parseMediaRequest(params) {
  const id = parsePositiveInteger(params.id, "TMDB id");
  if (params.type !== "movie" && params.type !== "tv") {
    const error = new Error("type must be movie or tv");
    error.statusCode = 400;
    throw error;
  }
  if (params.type === "movie") return { id, type: "movie" };
  return {
    id, type: "tv",
    season: parsePositiveInteger(params.season, "season", { max: 1000 }),
    episode: parsePositiveInteger(params.episode, "episode", { max: 10000 })
  };
}
