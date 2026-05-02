import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { cn } from "@/lib/utils";

export const Input = forwardRef<TextInput, TextInputProps & { className?: string }>(
  ({ className, ...props }, ref) => {
    return (
      <TextInput
        ref={ref}
        placeholderTextColor="#94a3b8"
        className={cn(
          "h-12 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
