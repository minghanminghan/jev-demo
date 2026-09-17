import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A textarea that is always exactly as tall as its text. Nobody has to drag a
 * corner: type a line, the box grows a line.
 */
export default function AutoTextarea({
  value,
  onChange,
  className = "",
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  /** Handed out so a caller can insert text at the cursor. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);

  return (
    <textarea
      ref={ref}
      rows={1}
      placeholder={placeholder}
      className={`field resize-none overflow-hidden leading-snug ${className}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
