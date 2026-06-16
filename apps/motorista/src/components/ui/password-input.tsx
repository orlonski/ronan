import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

/**
 * Campo de senha com botão de mostrar/ocultar (olho). Pro motorista conferir
 * o que digitou — importante com senha forte automática do iOS, que enche o
 * campo sem ele ver. Repassa todos os props pro Input (autoComplete etc).
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => {
  const [mostrar, setMostrar] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={mostrar ? "text" : "password"}
        className={cn("pr-12", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setMostrar((v) => !v)}
        className="absolute right-0 top-0 flex h-14 w-12 items-center justify-center text-muted-foreground"
        aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
        tabIndex={-1}
      >
        {mostrar ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
