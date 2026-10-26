export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;
export type IconStyle = "round" | "sharp" | "duo" | "sharp-duo";
export type Appearance = {
  theme: Theme;
  iconStyle: IconStyle;
  stroke: number;
  motion: boolean;
};

export const appearanceKey = "wd-appearance";
export const themes: readonly Theme[] = ["dark", "light", "system"];
export const iconStyles: readonly IconStyle[] = [
  "round",
  "sharp",
  "duo",
  "sharp-duo",
];
export const strokes: readonly number[] = [1.5, 1.75, 2];
export const defaultAppearance: Appearance = {
  theme: "dark",
  iconStyle: "round",
  stroke: 1.75,
  motion: true,
};

/** Принимает что угодно из localStorage и возвращает корректные настройки. */
export function parseAppearance(raw: unknown): Appearance {
  if (!raw || typeof raw !== "object") return { ...defaultAppearance };
  const value = raw as Partial<Record<keyof Appearance, unknown>>;
  return {
    theme: themes.includes(value.theme as Theme)
      ? (value.theme as Theme)
      : defaultAppearance.theme,
    iconStyle: iconStyles.includes(value.iconStyle as IconStyle)
      ? (value.iconStyle as IconStyle)
      : defaultAppearance.iconStyle,
    stroke: strokes.includes(value.stroke as number)
      ? (value.stroke as number)
      : defaultAppearance.stroke,
    motion:
      typeof value.motion === "boolean"
        ? value.motion
        : defaultAppearance.motion,
  };
}

export function resolveTheme(
  theme: Theme,
  prefersDark: boolean,
): ResolvedTheme {
  if (theme !== "system") return theme;
  return prefersDark ? "dark" : "light";
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

/**
 * Смена темы с кругом, который расходится от точки (обычно от кнопки).
 * update должен синхронно применить новую тему к DOM.
 */
export function revealTheme(
  origin: { x: number; y: number } | null,
  update: () => void,
) {
  const doc = document as ViewTransitionDocument;
  const reduced =
    document.documentElement.dataset.motion === "reduced" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduced) {
    update();
    return;
  }
  const x = origin?.x ?? innerWidth - 40;
  const y = origin?.y ?? 40;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const root = document.documentElement;
  root.classList.add("theme-transition");
  const transition = doc.startViewTransition(update);
  void transition.ready
    .then(() => {
      const animation = root.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 620,
          easing: "cubic-bezier(.7,0,.2,1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
      return animation.finished;
    })
    .catch(() => undefined)
    .finally(() => root.classList.remove("theme-transition"));
}

/** Переносит настройки на <html>; CSS читает data-theme и data-motion. */
export function applyAppearance(appearance: Appearance, prefersDark: boolean) {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(appearance.theme, prefersDark);
  if (appearance.motion) delete root.dataset.motion;
  else root.dataset.motion = "reduced";
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta)
    meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
}
