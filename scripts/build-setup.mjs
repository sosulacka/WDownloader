// Собирает приложение и два установщика в dist-installer/:
// лёгкий (только приложение) и офлайн (с yt-dlp, FFmpeg и Deno из tools/).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "dist-installer");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lite = process.argv.includes("--lite");
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

const tools = join(root, "tools");
const needed = ["yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe", "deno.exe"];
const present = existsSync(tools) ? readdirSync(tools) : [];
if (!lite && needed.every((name) => present.includes(name))) {
  run(pack, [...base, "--tools", tools, "--out", join(out, `Wdownloader-${version}-offline-setup.exe`)]);
} else if (!lite) {
  console.log("Офлайн-версия пропущена: в tools/ нет компонентов. Запустите npm run setup:tools.");
}
