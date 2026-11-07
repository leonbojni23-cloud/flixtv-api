import test from "node:test";
import assert from "node:assert/strict";
import { rewritePlaylist } from "../api/_lib/m3u8.js";

test("rewrites relative and absolute HLS segment references", () => {
  const input = "#EXTM3U\n#EXTINF:6,\nsegment-1.ts\nhttps://cdn.example/video/segment-2.ts";
  const output = rewritePlaylist(input, "https://cdn.example/video/master.m3u8", (url) => "/proxy?token=" + encodeURIComponent(url));
  assert.match(output, /\/proxy\?token=/);
  assert.match(output, /EXTINF:6/);
  assert.equal(output.split("\n").length, 4);
});

test("rewrites URI attributes such as encryption keys and preserves metadata", () => {
  const input = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../keys/key.bin"\n#EXTINF:5,Episode\npart.m4s';
  const output = rewritePlaylist(input, "https://cdn.example/show/playlist.m3u8", (url) => "/hls/" + encodeURIComponent(url));
  assert.match(output, /EXT-X-KEY:METHOD=AES-128,URI="\/hls\//);
  assert.match(output, /EXTINF:5,Episode/);
});

test("rejects invalid playlists and non-HTTPS sources", () => {
  assert.throws(() => rewritePlaylist("not a playlist", "https://cdn.example/a.m3u8", () => "/x"));
  assert.throws(() => rewritePlaylist("#EXTM3U\na.ts", "http://cdn.example/a.m3u8", () => "/x"));
  assert.throws(() => rewritePlaylist("#EXTM3U\na.ts", "https://cdn.example/a.m3u8", () => "/x"));
});
