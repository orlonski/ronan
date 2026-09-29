import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Celular: 16px e 44px de altura (abaixo de 16px o iOS dá zoom ao focar o campo).
 * `max-md:` de propósito: de 768px pra cima nada muda.
 *
 * `autoFocus` não vale em aparelho de toque: abrir o teclado sozinho cobre metade
 * da tela antes de a pessoa ver o formulário. Em mouse/teclado segue como sempre.
 * `autoFocus` não vira atributo no DOM (o React chama `.focus()` ao montar), então
 * ler o `matchMedia` no render não gera diferença de hidratação.
 */
function aparelhoDeToque(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, autoFocus, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      autoFocus={autoFocus && !aparelhoDeToque() ? true : undefined}
      className={cn(
        "flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-md:h-11 max-md:text-base",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
