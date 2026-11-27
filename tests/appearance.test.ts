import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultAppearance,
  parseAppearance,
  resolveTheme,
} from "../src/lib/appearance.ts";

test("Настройки вида восстанавливаются из localStorage", () => {
  assert.deepEqual(
    parseAppearance({
      theme: "light",
      iconStyle: "sharp-duo",
      stroke: 2,
      motion: false,
      scale: 85,
    }),
    { theme: "light", iconStyle: "sharp-duo", stroke: 2, motion: false, scale: 85 },
  );
});

test("Повреждённые и старые значения заменяются значениями по умолчанию", () => {
  for (const raw of [null, "dark", 42, []])
    assert.deepEqual(parseAppearance(raw), defaultAppearance);
  assert.deepEqual(
    parseAppearance({ theme: "graphite", iconStyle: "bold", stroke: 3, motion: "yes" }),
    defaultAppearance,
  );
  assert.equal(parseAppearance({ theme: "system" }).theme, "system");
  assert.equal(parseAppearance({ theme: "light" }).scale, 100);
  for (const scale of [0, 95, 150, "125", null])
    assert.equal(parseAppearance({ scale }).scale, 100);
});

test("Системная тема следует настройке ОС", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});
