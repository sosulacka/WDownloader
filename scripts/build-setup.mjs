// Собирает приложение и установщик в dist-installer/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "dist-installer");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (process.argv.includes("--offline")) {
  throw new Error("Офлайн-установщик больше не собирается. Компоненты скачиваются из их репозиториев при первом запуске.");
}
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit" });

console.log("1/3 Приложение");
run(process.execPath, [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--no-bundle", "--ci", "--", "--locked"]);

console.log("2/3 Установщик");
run("cargo", ["build", "--release", "--locked"], join(root, "installer"));

console.log("3/3 Упаковка");
mkdirSync(out, { recursive: true });
const pack = join(root, "installer", "target", "release", "pack.exe");
const base = [
  "--setup", join(root, "installer", "target", "release", "wdownloader-setup.exe"),
  "--app", join(root, "src-tauri", "target", "release", "wdownloader.exe"),
  "--license", join(root, "LICENSE"),
  "--notice", join(root, "NOTICE"),
  "--licenses", join(root, "licenses"),
];
run(pack, [...base, "--out", join(out, `Wdownloader-${version}-setup.exe`)]);
