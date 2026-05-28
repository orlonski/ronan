import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Botões pensados pra dedo grosso (motorista, sol, tela suja):
// default 56px, lg 64px, sm 44px, icon 56px square.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2.5 rounded-xl font-semibold transition-opacity active:opacity-75 disabled:opacity-50 disabled:active:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        outline: "border-2 border-border bg-background text-foreground",
        ghost: "bg-transparent text-foreground active:bg-muted",
        destructive: "bg-destructive text-destructive-foreground",
        brand: "bg-brand text-brand-foreground",
        secondary: "bg-secondary text-secondary-foreground",
      },
      size: {
        default: "h-14 px-5 text-base",
        sm: "h-11 px-4 text-sm",
        lg: "h-16 px-6 text-lg",
        xl: "h-20 px-6 text-xl",
        icon: "h-14 w-14",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    children?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...rest}
      >
        {loading && (
          <span
            aria-hidden
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
