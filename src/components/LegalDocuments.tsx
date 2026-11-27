import { useEffect, useId, useRef, useState } from "react";
import { t, useLanguage } from "../lib/i18n";
import LanguageSwitch from "./LanguageSwitch";
import termsRu from "../../legal/terms.md?raw";
import privacyRu from "../../legal/privacy.md?raw";
import termsEn from "../../legal/terms.en.md?raw";
import privacyEn from "../../legal/privacy.en.md?raw";

const documents = {
  ru: [termsRu, privacyRu],
  en: [termsEn, privacyEn],
};

export default function LegalDocuments({ onAccept }: { onAccept?: () => void }) {
  const language = useLanguage();
  const id = useId();
  const scroll = useRef<HTMLDivElement>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const node = scroll.current;
    if (!node || !onAccept) return;
    setReachedEnd(false);
    setChecked(false);
    node.scrollTop = 0;
    const fits = () => {
      if (node.scrollHeight <= node.clientHeight + 1) setReachedEnd(true);
    };
    fits();
    const observer = new ResizeObserver(fits);
    observer.observe(node);
    return () => observer.disconnect();
  }, [language, onAccept]);

  return (
    <section className="legal-documents" aria-labelledby={`${id}-title`}>
      <header className="legal-header">
        <div>
          <h2 id={`${id}-title`}>{t("Условия и конфиденциальность")}</h2>
          {onAccept && <p>{t("Прокрутите оба документа до конца, чтобы продолжить.")}</p>}
        </div>
        {onAccept && <LanguageSwitch />}
      </header>
      <div
        className="legal-scroll"
        ref={scroll}
        tabIndex={0}
        role="region"
        aria-labelledby={`${id}-title`}
        onScroll={({ currentTarget: node }) => {
          if (node.scrollHeight - node.clientHeight - node.scrollTop <= 2) setReachedEnd(true);
        }}
      >
        {documents[language].map((document) => (
          <article key={document.slice(0, document.indexOf("\n"))}>
            {document.split(/\r?\n/).filter(Boolean).map((line, index) => {
              if (line.startsWith("# ")) return <h3 key={index}>{line.slice(2)}</h3>;
              if (line.startsWith("## ")) return <h4 key={index}>{line.slice(3)}</h4>;
              return <p key={index}>{line}</p>;
            })}
          </article>
        ))}
      </div>
      {onAccept && (
        <footer className="legal-footer">
          <label className="option-check">
            <input
              type="checkbox"
              disabled={!reachedEnd}
              checked={checked}
              onChange={(event) => setChecked(event.currentTarget.checked)}
            />
            {t("Я принимаю пользовательское соглашение и ознакомился с политикой конфиденциальности.")}
          </label>
          <button
            type="button"
            className="button primary"
            disabled={!reachedEnd || !checked}
            onClick={onAccept}
          >
            {t("Принять и продолжить")}
          </button>
        </footer>
      )}
    </section>
  );
}
