import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Input pensado pra ler em sol, dedo grosso, tela suja:
// h-14, font-medium ~17px, padding generoso, borda 2px.
// font-size 16px no CSS base evita zoom iOS ao focar.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type ?? "text"}
        className={cn(
          "h-14 w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-[17px] font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
