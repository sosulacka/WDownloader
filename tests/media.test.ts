import test from "node:test";
import assert from "node:assert/strict";
import { parseTimecode, setBoundary, timecode } from "../src/lib/media.ts";

test("Таймкоды принимают секунды, минуты и часы", () => {
  assert.equal(parseTimecode("4,9"), 4.9);
  assert.equal(parseTimecode("02:15.5"), 135.5);
  assert.equal(parseTimecode("01:02:03.4"), 3723.4);
  for (const invalid of ["-1", "1:60", "00:00:99", "NaN", "", "1.2:30"]) {
    assert.equal(parseTimecode(invalid), null, invalid);
  }
});

test("Округление таймкода корректно переносит минуты и часы", () => {
  assert.equal(timecode(59.99), "01:00.0");
  assert.equal(timecode(3599.99), "01:00:00.0");
  assert.equal(timecode(-1), "00:00.0");
  assert.equal(parseTimecode(timecode(1234.5)), 1234.5);
});

test("Границы не пересекаются и остаются в пределах ролика", () => {
  const range = { start: 4, end: 9 };
  assert.deepEqual(setBoundary(range, "start", 12, 19), { start: 8.9, end: 9 });
  assert.deepEqual(setBoundary(range, "start", -5, 19), { start: 0, end: 9 });
  assert.deepEqual(setBoundary(range, "end", 2, 19), { start: 4, end: 4.1 });
  assert.deepEqual(setBoundary(range, "end", 100, 19), { start: 4, end: 19 });
  assert.deepEqual(setBoundary(range, "start", 4.26, 19), {
    start: 4.3,
    end: 9,
  });
});
