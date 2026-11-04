import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "default" | "primary" | "tonal" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = a view's one solid-magenta call to action; tonal = a magenta-tint fill for a
   * frequent action that should stand out from the plain buttons without competing with it. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as a square, single-glyph icon button (`.btn.icon`) - pass a single icon/emoji
   * as children and an `aria-label` for the accessible name. Combines with `size="sm"`. */
  icon?: boolean;
  children: ReactNode;
}

/** Wraps the global `.btn` family already defined in styles/base.css (ported verbatim
 * from the prototype) - there is no additional per-variant styling needed, so this
 * component intentionally has no CSS Module of its own. */
export function Button({ variant = "default", size = "md", icon = false, className, children, type, ...rest }: ButtonProps) {
  const classes = ["btn"];
  if (variant === "primary") classes.push("primary");
  if (variant === "tonal") classes.push("tonal");
  if (variant === "ghost") classes.push("ghost");
  if (variant === "danger") classes.push("danger");
  if (icon) classes.push("icon");
  if (size === "sm") classes.push("sm");
  if (className) classes.push(className);
  return (
    <button type={type ?? "button"} className={classes.join(" ")} {...rest}>
      {children}
    </button>
  );
}
