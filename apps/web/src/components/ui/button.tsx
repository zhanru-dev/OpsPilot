import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      children,
      disabled,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          variant === "primary" &&
            "border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]",
          variant === "secondary" &&
            "border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-[var(--surface-muted)]",
          variant === "ghost" &&
            "border-transparent bg-transparent text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
          variant === "danger" &&
            "border-[var(--danger)] bg-[var(--danger)] text-white hover:bg-[#85302f]",
          size === "sm" && "h-8 px-3 text-xs",
          size === "md" && "h-10 px-4 text-sm",
          size === "icon" && "size-9 p-0",
          className,
        )}
        {...props}
      >
        {loading ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : null}
        {children}
      </button>
    );
  },
);
