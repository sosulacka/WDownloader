import english from "./locales/en.js";

let language = "ru";
const listeners = new Set();
const reverse = new Map(Object.entries(english).map(([ru, en]) => [en, ru]));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(english)
  .filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.length - a.length)
  .flatMap(([ru, en]) => [ru, en].map((text) => {
    const slots = [];
    const parts = text.split(/(\{\d+\})/g).map((part) => {
      const match = /^\{(\d+)\}$/.exec(part);
      if (!match) return escape(part);
      slots.push(match[1]);
      return "([\\s\\S]*?)";
    });
    return { ru, en, slots, expression: new RegExp(`^${parts.join("")}$`) };
  }));

export const getLanguage = () => language;
export const localeTag = () => language === "ru" ? "ru-RU" : "en-US";
export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setLanguage(next) {
  if (next !== "ru" && next !== "en") return;
  language = next;
  document.documentElement.lang = next;
  try { localStorage.setItem("wd-language", next); } catch { /* На эту сессию хватит. */ }
  listeners.forEach((listener) => listener());
}
export function initializeLanguage() {
  let saved;
  try { saved = localStorage.getItem("wd-language"); } catch { /* Берём язык системы. */ }
  const system = navigator.languages?.[0] || navigator.language || "en";
  setLanguage(saved === "ru" || saved === "en" ? saved : system.toLowerCase().startsWith("ru") ? "ru" : "en");
}

// Общий перевод для приложения и установщика.
export function t(message, parameters) {
  if (typeof message !== "string" || !message) return message;
  const source = Object.hasOwn(english, message) ? message : reverse.get(message);
  let template = source ? language === "ru" ? source : english[source] : message;
  let values = parameters;
  if (!source && !parameters) {
    for (const pattern of patterns) {
      const match = pattern.expression.exec(message);
      if (!match) continue;
      values = Object.fromEntries(pattern.slots.map((slot, index) => [slot, match[index + 1]]));
      template = language === "ru" ? pattern.ru : pattern.en;
      break;
    }
  }
  return template.replace(/\{(\d+)\}/g, (slot, index) => values?.[index] == null ? slot : String(values[index]));
}
