import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "text-base font-semibold uppercase tracking-wide text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
Label.displayName = "Label";
