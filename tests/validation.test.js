import test from "node:test";
import assert from "node:assert/strict";
import { parseMovie, parseTv, positiveInteger } from "../api/_lib/validation.js";

test("accepts a valid movie ID", () => {
  assert.deepEqual(parseMovie("550"), { type: "movie", id: 550 });
});

test("accepts a valid TV episode", () => {
  assert.deepEqual(parseTv("1399", "1", "2"), {
    type: "tv", id: 1399, season: 1, episode: 2
  });
});

test("rejects invalid IDs and episode values", () => {
  assert.throws(() => positiveInteger("0", "id"));
  assert.throws(() => positiveInteger("1.5", "id"));
  assert.throws(() => parseTv("1399", "1001", "1"));
  assert.throws(() => parseTv("1399", "1", "10001"));
});
