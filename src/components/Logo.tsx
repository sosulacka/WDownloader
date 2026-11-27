export default function Logo({ size = 28 }: { size?: number }) {
  return <img className="logo-mark" src="/favicon.svg" alt="" width={size} height={size} draggable={false} />;
}

export function Wordmark() {
  return <span className="wordmark">DOWNLOADER</span>;
}
