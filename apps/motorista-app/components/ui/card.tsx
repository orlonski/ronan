import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ViewProps & { className?: string }) {
  return (
    <View
      className={cn(
        "rounded-2xl border-2 border-border bg-card p-5",
        className,
      )}
      {...props}
    />
  );
}
