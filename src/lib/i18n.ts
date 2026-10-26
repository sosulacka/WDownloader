import { useSyncExternalStore } from "react";
import { getLanguage, subscribeLanguage } from "../../installer/ui/i18n.js";

export { t, getLanguage, setLanguage, initializeLanguage, localeTag } from "../../installer/ui/i18n.js";
export type { Language } from "../../installer/ui/i18n.js";
export function useLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, () => "ru" as const);
}
