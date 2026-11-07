export function positiveInteger(value, field, max = 1_000_000) {
  const text = String(value ?? "");
  if (!/^\\d+$/.test(text)) throw Object.assign(new Error(`Invalid ${field}`), { statusCode: 400 });
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw Object.assign(new Error(`Invalid ${field}`), { statusCode: 400 });
  }
  return number;
}

export function parseMediaPath(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "v1" && parts[1] === "stream" && parts[2] === "health") {
    return { kind: "stream-health" };
  }
  if (parts.length === 4 && parts[0] === "v1" && parts[1] === "stream" && parts[2] === "movie") {
    return { kind: "media", media: { type: "movie", id: positiveInteger(parts[3], "TMDB id") } };
  }
  if (parts.length === 8 && parts[0] === "v1" && parts[1] === "stream" && parts[2] === "tv" && parts[4] === "season" && parts[6] === "episode") {
    return {
      kind: "media",
      media: {
        type: "tv",
        id: positiveInteger(parts[3], "TMDB id"),
        season: positiveInteger(parts[5], "season", 1000),
        episode: positiveInteger(parts[7], "episode", 10000)
      }
    };
  }
  return null;
}
