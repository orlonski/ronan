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
  RODAPE_FOLHA,
  classesFolha,
  juntarRefs,
  useTecladoDaFolha,
  type ModoFolha,
} from "./folha-mobile";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Só no celular. `baixo` (padrão) = folha de baixo; `centrado` = confirmação curta. Ver `folha-mobile.tsx`. */
    modoCelular?: ModoFolha;
    /** Classes do miolo que rola (só no celular). Ex.: `max-md:px-0` quando o conteúdo tem padding próprio. */
    corpoClassName?: string;
  }
>(({ className, children, modoCelular = "baixo", corpoClassName, ...props }, ref) => {
  const conteudo = React.useRef<HTMLDivElement | null>(null);
  const [no, setNo] = React.useState<HTMLDivElement | null>(null);
  // estável: uma ref nova a cada render seria chamada com null e depois com o nó, disparando setNo em loop
  const refJunta = React.useMemo(() => juntarRefs<HTMLDivElement>(ref, conteudo, setNo), [ref]);
  const fechar = React.useRef<HTMLButtonElement | null>(null);
  useTecladoDaFolha(no, modoCelular === "baixo");
  const baixo = modoCelular === "baixo";
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={refJunta}
        data-folha={modoCelular}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out sm:rounded-lg",
          classesFolha(modoCelular, "dialog"),
          className,
        )}
        {...props}
      >
        {baixo && <AlcaFolha conteudo={conteudo} fechar={fechar} />}
        {baixo ? <div className={cn(CORPO_FOLHA, corpoClassName)}>{children}</div> : children}
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
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", CABECALHO_FOLHA, className)} {...props} />
);

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse max-md:gap-2 sm:flex-row sm:justify-end sm:space-x-2", RODAPE_FOLHA, className)}
    {...props}
  />
);
