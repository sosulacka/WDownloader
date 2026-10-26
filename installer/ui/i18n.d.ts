export type Language = "ru" | "en";
export function getLanguage(): Language;
export function localeTag(): "ru-RU" | "en-US";
export function setLanguage(language: Language): void;
export function initializeLanguage(): void;
export function subscribeLanguage(listener: () => void): () => void;
export function t(message: string, parameters?: Record<string | number, unknown>): string;
