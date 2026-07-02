import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { cn } from "@/lib/utils";

// Input pensado pra ler fácil em sol, dedo grosso, tela suja:
// h-14 (vs ~48px), font-medium 17px, padding generoso, borda mais grossa.
export const Input = forwardRef<
  TextInput,
  TextInputProps & { className?: string; error?: boolean }
>(({ className, error, ...props }, ref) => {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor="#94a3b8"
      className={cn(
        "h-14 rounded-xl border-2 bg-background px-4 py-2 text-[17px] font-medium text-foreground",
        error ? "border-destructive bg-destructive/5" : "border-border",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
