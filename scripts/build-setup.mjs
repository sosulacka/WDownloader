// Собирает приложение и два установщика в dist-installer/:
// лёгкий (только приложение) и офлайн (с yt-dlp, FFmpeg и Deno из tools/).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "dist-installer");
const version = "0.1.0";
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

console.log("1/3 Приложение");
run("npx", ["tauri", "build", "--no-bundle"]);

console.log("2/3 Установщик");
run("cargo", ["build", "--release"], join(root, "installer"));

console.log("3/3 Упаковка");
mkdirSync(out, { recursive: true });
const pack = join(root, "installer", "target", "release", "pack.exe");
const base = [
  "--setup", join(root, "installer", "target", "release", "wdownloader-setup.exe"),
  "--app", join(root, "src-tauri", "target", "release", "wdownloader.exe"),
];
run(pack, [...base, "--out", join(out, `Wdownloader-${version}-setup.exe`)]);

const tools = join(root, "tools");
const needed = ["yt-dlp.exe", "ffmpeg.exe", "ffprobe.exe", "deno.exe"];
const present = existsSync(tools) ? readdirSync(tools) : [];
if (needed.every((name) => present.includes(name))) {
  run(pack, [...base, "--tools", tools, "--out", join(out, `Wdownloader-${version}-offline-setup.exe`)]);
} else {
  console.log("Офлайн-версия пропущена: в tools/ нет компонентов. Запустите npm run setup:tools.");
}
