import { t, useLanguage } from "../lib/i18n";

type Props<T extends string> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, React.ReactNode])[];
  size?: "sm" | "md";
};

export default function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  size = "md",
}: Props<T>) {
  useLanguage();

  return (
    <div
      className={`segmented ${size}`}
      role="group"
      aria-label={t(label)}
    >
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
