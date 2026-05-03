import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { cn } from "@/lib/utils";

// Input pensado pra ler fácil em sol, dedo grosso, tela suja:
// h-14 (vs ~48px), font-medium 17px, padding generoso, borda mais grossa.
export const Input = forwardRef<TextInput, TextInputProps & { className?: string }>(
  ({ className, ...props }, ref) => {
    return (
      <TextInput
        ref={ref}
        placeholderTextColor="#94a3b8"
        className={cn(
          "h-14 rounded-xl border-2 border-border bg-background px-4 py-2 text-[17px] font-medium text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
