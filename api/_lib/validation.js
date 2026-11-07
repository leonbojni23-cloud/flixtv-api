export function positiveInteger(value, field, max = 1_000_000) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) throw Object.assign(new Error(\`Invalid \${field}\`), { statusCode: 400 });
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw Object.assign(new Error(\`Invalid \${field}\`), { statusCode: 400 });
  }
  return number;
}

export function parseMovie(id) {
  return { type: "movie", id: positiveInteger(id, "TMDB id") };
}

export function parseTv(id, season, episode) {
  return {
    type: "tv",
    id: positiveInteger(id, "TMDB id"),
    season: positiveInteger(season, "season", 1000),
    episode: positiveInteger(episode, "episode", 10000)
  };
}
