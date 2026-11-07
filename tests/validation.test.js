import test from "node:test";
import assert from "node:assert/strict";
import { parseMediaPath, positiveInteger } from "../api/_lib/validation.js";

test("accepts valid movie path", () => {
  assert.deepEqual(parseMediaPath("v1/stream/movie/550"), {
    kind: "media",
    media: { type: "movie", id: 550 }
  });
});

test("accepts valid TV episode path", () => {
  assert.deepEqual(parseMediaPath("v1/stream/tv/1399/season/1/episode/2"), {
    kind: "media",
    media: { type: "tv", id: 1399, season: 1, episode: 2 }
  });
});

test("rejects invalid IDs and path traversal", () => {
  assert.throws(() => positiveInteger("0", "id"));
  assert.throws(() => positiveInteger("1.5", "id"));
  assert.equal(parseMediaPath("v1/stream/movie/../../secret"), null);
  assert.equal(parseMediaPath("v1/stream/tv/1/season/1001/episode/1"), null);
});
