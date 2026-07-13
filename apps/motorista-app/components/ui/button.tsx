import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { cn } from "@/lib/utils";

// Botoes pensados pra dedo grosso de motorista de pedreira:
// - default 56px (vs ~48px padrao)
// - lg 64px (botao primario "Salvar viagem", "Nova viagem")
// - icon 56px (touch alvos generosos)
const buttonVariants = cva(
  "flex-row items-center justify-center gap-2.5 rounded-xl active:opacity-75 disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary",
        outline: "border-2 border-border bg-background",
        ghost: "bg-transparent active:bg-muted",
        destructive: "bg-destructive",
        brand: "bg-brand",
        // Semáforo: success=confirmar/certo, warning=cuidado/atenção.
        success: "bg-success",
        warning: "bg-warning",
      },
      size: {
        default: "h-14 px-5",
        sm: "h-11 px-4",
        lg: "h-16 px-6",
        icon: "h-14 w-14",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const buttonTextVariants = cva("font-semibold", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      outline: "text-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive-foreground",
      brand: "text-brand-foreground",
      success: "text-success-foreground",
      warning: "text-warning-foreground",
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
            color={
              variant === "outline" || variant === "ghost"
                ? "#0f172a"
                : "#fff"
            }
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
