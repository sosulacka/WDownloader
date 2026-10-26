/**
 * Знак: W собран из двух стрелок вниз (double-v), под ними лоток загрузки.
 * Правая стрелка приглушена, как во втором тоне Keyline.
 */
export default function Logo({
  size = 28,
  busy = false,
}: {
  size?: number;
  busy?: boolean;
}) {
  return (
    <svg
      className={`logo-mark ${busy ? "busy" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect className="logo-bg" width="32" height="32" rx="9" />
      <g className="logo-glyph">
        <path className="logo-v1" d="M8 8 12 18 16 10" pathLength={1} />
        <path className="logo-v2" d="M16 10 20 18 24 8" pathLength={1} />
      </g>
      <path
        className="logo-tray"
        d="M8.5 21v1.25A2.25 2.25 0 0 0 10.75 24.5h10.5a2.25 2.25 0 0 0 2.25-2.25V21"
        pathLength={1}
      />
    </svg>
  );
}

export function Wordmark() {
  return <span className="wordmark">DOWNLOADER</span>;
}
