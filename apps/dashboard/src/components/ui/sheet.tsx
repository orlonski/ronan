"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlcaFolha,
  CABECALHO_FOLHA,
  CORPO_FOLHA,
  FECHAR_FOLHA,
  classesFolha,
  juntarRefs,
  useTecladoDaFolha,
} from "./folha-mobile";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Classes do miolo que rola (só no celular, onde a gaveta vira folha de baixo). */
    corpoClassName?: string;
  }
>(({ className, children, corpoClassName, ...props }, ref) => {
  const conteudo = React.useRef<HTMLDivElement | null>(null);
  const [no, setNo] = React.useState<HTMLDivElement | null>(null);
  // estável: uma ref nova a cada render seria chamada com null e depois com o nó, disparando setNo em loop
  const refJunta = React.useMemo(() => juntarRefs<HTMLDivElement>(ref, conteudo, setNo), [ref]);
  const fechar = React.useRef<HTMLButtonElement | null>(null);
  useTecladoDaFolha(no, true);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={refJunta}
        data-folha="baixo"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col gap-4 border-l bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          classesFolha("baixo", "sheet"),
          className,
        )}
        {...props}
      >
        <AlcaFolha conteudo={conteudo} fechar={fechar} />
        <div className={cn(CORPO_FOLHA, corpoClassName)}>{children}</div>
        <DialogPrimitive.Close
          ref={fechar}
          className={cn(
            "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
            FECHAR_FOLHA,
          )}
        >
          <X className="h-4 w-4 max-md:h-5 max-md:w-5" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = "SheetContent";

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 pr-8", CABECALHO_FOLHA, className)} {...props} />
);

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
