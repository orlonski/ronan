import { Text, type TextProps } from "react-native";
import { cn } from "@/lib/utils";

export function Label({
  className,
  error,
  ...props
}: TextProps & { className?: string; error?: boolean }) {
  return (
    <Text
      className={cn(
        "text-base font-semibold uppercase tracking-wide",
        error ? "text-destructive" : "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
