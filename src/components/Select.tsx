import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "./icons";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
};

export default function Select({
  label,
  value,
  onChange,
  children,
  disabled,
}: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 260,
  });
  const options = Children.toArray(children)
    .filter(isValidElement<{ value: string; children: React.ReactNode }>)
    .map((child) => ({
      value: String(child.props.value),
      label: child.props.children,
    }));

  function show() {
    if (disabled || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const height = Math.min(options.length * 40 + 10, 270);
    const below = window.innerHeight - rect.bottom - 12;
    setPosition({
      left: rect.left,
      width: rect.width,
      top:
        below < height && rect.top > height
          ? rect.top - height - 6
          : rect.bottom + 6,
      maxHeight: height,
    });
    setHighlight(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setExpanded(true);
  }

  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        setExpanded(false);
    };
    const reposition = (event: Event) => {
      if (
        event.type === "scroll" &&
        menu.current?.contains(event.target as Node)
      )
        return;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded)
      menu.current
        ?.querySelector(`#${CSS.escape(`${id}-${highlight}`)}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [highlight, expanded, id]);

  function choose(index: number) {
    onChange(options[index].value);
    setExpanded(false);
    trigger.current?.focus();
  }
  return (
    <div className="select-field">
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className={`custom-select ${expanded ? "expanded" : ""}`}
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-haspopup="listbox"
        aria-activedescendant={expanded ? `${id}-${highlight}` : undefined}
        disabled={disabled}
        onClick={() => (expanded ? setExpanded(false) : show())}
        onKeyDown={(event) => {
          if (
            [
              "ArrowDown",
              "ArrowUp",
              "Home",
              "End",
              "Enter",
              " ",
              "Escape",
            ].includes(event.key)
          ) {
            event.preventDefault();
            if (event.key === "Escape") {
              setExpanded(false);
              return;
            }
            if (!expanded) {
              show();
              return;
            }
            if (event.key === "ArrowDown")
              setHighlight((i) => (i + 1) % options.length);
            else if (event.key === "ArrowUp")
              setHighlight((i) => (i - 1 + options.length) % options.length);
            else if (event.key === "Home") setHighlight(0);
            else if (event.key === "End") setHighlight(options.length - 1);
            else choose(highlight);
          } else if (event.key === "Tab") setExpanded(false);
        }}
      >
        <span>
          {options.find((option) => option.value === value)?.label ||
            options[0]?.label}
        </span>
        <ChevronDown size={15} />
      </button>
      {expanded &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-list`}
            className="select-menu"
            role="listbox"
            aria-labelledby={`${id}-label`}
            style={position}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                tabIndex={-1}
                className={`select-option ${index === highlight ? "highlighted" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Check size={15} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
