import { cva, type VariantProps } from "class-variance-authority";
import { Text, View } from "react-native";
import { cn } from "@/lib/utils";

const badgeVariants = cva("self-start rounded-md px-2.5 py-1", {
  variants: {
    variant: {
      default: "bg-brand",
      secondary: "bg-secondary",
      outline: "border-2 border-border bg-transparent",
      destructive: "bg-destructive",
      success: "bg-success",
      warning: "bg-warning",
    },
  },
  defaultVariants: { variant: "default" },
});

const badgeTextVariants = cva("text-xs font-bold uppercase tracking-wide", {
  variants: {
    variant: {
      default: "text-brand-foreground",
      secondary: "text-secondary-foreground",
      outline: "text-foreground",
      destructive: "text-destructive-foreground",
      success: "text-white",
      warning: "text-warning-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  textClassName,
  variant,
  children,
}: {
  className?: string;
  textClassName?: string;
  children: React.ReactNode;
} & VariantProps<typeof badgeVariants>) {
  return (
    <View className={cn(badgeVariants({ variant }), className)}>
      <Text className={cn(badgeTextVariants({ variant }), textClassName)}>{children}</Text>
    </View>
  );
}
