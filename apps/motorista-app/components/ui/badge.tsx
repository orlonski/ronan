import { cva, type VariantProps } from "class-variance-authority";
import { Text, View } from "react-native";
import { cn } from "@/lib/utils";

const badgeVariants = cva("self-start rounded-full px-2 py-0.5", {
  variants: {
    variant: {
      default: "bg-primary",
      secondary: "bg-secondary",
      outline: "border border-border bg-transparent",
      destructive: "bg-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

const badgeTextVariants = cva("text-xs font-medium", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      outline: "text-foreground",
      destructive: "text-destructive-foreground",
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
