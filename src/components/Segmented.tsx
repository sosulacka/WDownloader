import { t, useLanguage } from "../lib/i18n";
import { useLayoutEffect, useRef, useState } from "react";

type Props<T extends string> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, React.ReactNode])[];
  size?: "sm" | "md";
};

/** Переключатель с плавающей подложкой под выбранным вариантом. */
export default function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  size = "md",
}: Props<T>) {
  const language = useLanguage();
  const root = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const active = root.current?.querySelector<HTMLElement>(
        '[aria-pressed="true"]',
      );
      setThumb(active ? { x: active.offsetLeft, w: active.offsetWidth } : null);
    };
    measure();
    if (!root.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [value, options, language]);

  return (
    <div
      ref={root}
      className={`segmented ${size}`}
      role="group"
      aria-label={t(label)}
    >
      {thumb && (
        <span
          className="segmented-thumb"
          aria-hidden="true"
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
        />
      )}
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {typeof text === "string" ? t(text) : text}
        </button>
      ))}
    </div>
  );
}
