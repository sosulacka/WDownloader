import { setLanguage, t, useLanguage } from "../lib/i18n";
import Segmented from "./Segmented";

export default function LanguageSwitch() {
  const language = useLanguage();
  return (
    <Segmented
      label={t("Язык интерфейса")}
      value={language}
      onChange={setLanguage}
      size="sm"
      options={[["ru", "RU"], ["en", "EN"]]}
    />
  );
}
