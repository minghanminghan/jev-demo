import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "jev-theme";
const EVENT = "jev-theme-change";

function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** localStorage is the store; a custom event tells React it moved. */
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/*
  Reading storage can throw, not just come back empty: Safari with cookies
  blocked, and any third-party-blocked iframe, refuse the whole API. This is
  the `getSnapshot` for useSyncExternalStore, so a throw here happens during
  render and takes the entire app down with it. The inline script in index.html
  guards the same read; so does this.
*/
const read = (): Theme => {
  try {
    return (localStorage.getItem(KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
};

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * One icon button showing the current preference, which opens a small menu of
 * the three choices. Same shape as the toggle on docs.typesafe.ai.
 */
export default function ThemeToggle() {
  // The inline script in index.html already set the attribute before paint.
  // The third argument is the no-storage fallback: treat that as "system".
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Keep "system" live when the OS flips. Touches the DOM only, no state.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (read() === "system") apply("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Click outside or press Escape to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (next: Theme) => {
    // Same reason as `read`. The theme still changes for this tab; it just
    // will not be remembered where storage is refused.
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* not remembered, still applied */
    }
    apply(next);
    window.dispatchEvent(new Event(EVENT));
    setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Change theme preference"
        onClick={() => setOpen(!open)}
        className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-muted transition-colors hover:bg-panel2 hover:text-foreground"
      >
        <Icon theme={theme} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 w-36 rounded-xl border border-line bg-background p-1 shadow-lg"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.value}
              onClick={() => pick(option.value)}
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-panel2 ${
                theme === option.value ? "text-foreground" : "text-muted"
              }`}
            >
              <Icon theme={option.value} />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sun, moon and monitor, traced from the same 18px grid the docs use. */
function Icon({ theme }: { theme: Theme }) {
  const common = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 18 18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-4 w-4 shrink-0",
    "aria-hidden": true,
  };

  if (theme === "light") {
    return (
      <svg {...common}>
        <path d="M9 1.25V2.25M14.48 3.52L13.773 4.227M16.75 9H15.75M14.48 14.48L13.773 13.773M9 16.75V15.75M3.52 14.48L4.227 13.773M1.25 9H2.25M3.52 3.52L4.227 4.227" />
        <path d="M9 13.25C11.3472 13.25 13.25 11.3472 13.25 9C13.25 6.65279 11.3472 4.75 9 4.75C6.65279 4.75 4.75 6.65279 4.75 9C4.75 11.3472 6.65279 13.25 9 13.25Z" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M13 11.75C9.548 11.75 6.75 8.952 6.75 5.5C6.75 4.148 7.183 2.901 7.912 1.878C4.548 2.506 2 5.453 2 9C2 13.004 5.246 16.25 9.25 16.25C12.622 16.25 15.448 13.944 16.259 10.826C15.309 11.409 14.196 11.75 13 11.75Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4.5 15.5L9 14.5L13.5 15.5" />
      <path d="M9 11.75V14.5" />
      <path d="M14.25 2.75H3.75C2.645 2.75 1.75 3.645 1.75 4.75V9.75C1.75 10.855 2.645 11.75 3.75 11.75H14.25C15.355 11.75 16.25 10.855 16.25 9.75V4.75C16.25 3.645 15.355 2.75 14.25 2.75Z" />
    </svg>
  );
}
