import type { ButtonHTMLAttributes, ReactNode } from "react";

type Size = "sm" | "md" | "lg";
type Variant = "default" | "subtle" | "danger" | "overlay";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: Size;
  variant?: Variant;
}

// Touch targets (WCAG AA: 24px+, Apple HIG: 44pt, Material: 48dp).
// We sit comfortably above the accessibility floor at md (36px) and bump up
// to lg (44px) for primary actions that need to be hit precisely on mobile.
const sizes: Record<Size, string> = {
  sm: "w-7 h-7 text-sm",
  md: "w-9 h-9 text-base",
  lg: "w-11 h-11 text-lg",
};

const variants: Record<Variant, string> = {
  default: "text-gray-500 hover:text-gray-900 hover:bg-gray-100",
  subtle: "text-gray-400 hover:text-gray-700 hover:bg-gray-100",
  danger: "text-gray-400 hover:text-red-600 hover:bg-red-50",
  overlay:
    "text-white bg-black/40 hover:bg-black/60 backdrop-blur-sm disabled:opacity-30",
};

/**
 * Square icon-only button with a comfortable click/touch target.
 * Use for X close buttons, inline removes, carousel arrows — anywhere a
 * bare text glyph would otherwise have a sub-30px hit area.
 */
export default function IconButton({
  children,
  size = "md",
  variant = "default",
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center rounded-full leading-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
