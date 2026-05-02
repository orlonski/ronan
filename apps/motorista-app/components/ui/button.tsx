import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-lg active:opacity-80 disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary",
        outline: "border border-border bg-background",
        ghost: "bg-transparent active:bg-muted",
        destructive: "bg-destructive",
      },
      size: {
        default: "h-12 px-4",
        sm: "h-10 px-3",
        lg: "h-14 px-6",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const buttonTextVariants = cva("text-base font-medium", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      outline: "text-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive-foreground",
    },
    size: {
      default: "text-base",
      sm: "text-sm",
      lg: "text-lg",
      icon: "text-base",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = {
  className?: string;
  textClassName?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: React.ReactNode;
} & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<View, ButtonProps>(
  (
    { className, textClassName, variant, size, loading, disabled, onPress, children, ...rest },
    ref,
  ) => {
    return (
      <Pressable
        ref={ref}
        disabled={disabled || loading}
        onPress={onPress}
        className={cn(buttonVariants({ variant, size }), className)}
        {...rest}
      >
        {loading && (
          <ActivityIndicator
            size="small"
            color={variant === "outline" || variant === "ghost" ? "#0f172a" : "#fff"}
          />
        )}
        {typeof children === "string" ? (
          <Text className={cn(buttonTextVariants({ variant, size }), textClassName)}>
            {children}
          </Text>
        ) : (
          children
        )}
      </Pressable>
    );
  },
);
Button.displayName = "Button";
