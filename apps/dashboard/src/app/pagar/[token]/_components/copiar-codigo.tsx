"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * O botão que esta página inteira existe pra oferecer.
 *
 * O copia-e-cola do Pix tem ~230 caracteres. No WhatsApp, o toque longo copia
 * a mensagem INTEIRA — com a saudação junto — e o banco recusa o que vem
 * colado, sem dizer por quê. Selecionar só o código na mão, no celular, sem
 * perder um byte, é o que a gente estava pedindo pro financeiro do cliente
 * fazer. Aqui é um toque.
 *
 * O `execCommand` fica de rede porque `navigator.clipboard` não existe em
 * contexto não-seguro (HTTP) nem em alguns webviews — e "copiar" que não copia
 * numa página de pagamento é pior que não ter botão: a pessoa acha que copiou.
 */
export function CopiarCodigo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2500);
    return () => clearTimeout(t);
  }, [copiado]);

  /**
   * O plano B. Roda quando a API moderna não existe E quando ela existe mas
   * recusa — que é o caso comum, não o exótico: `writeText` REJEITA quando a
   * permissão está negada, em webview e em contexto não-seguro. Testar só
   * `navigator.clipboard?.writeText` parece cobrir e não cobre; o primeiro
   * clique nesta tela, no Chromium, caiu exatamente aí.
   */
  function copiarNaMarra(): boolean {
    const campo = document.createElement("textarea");
    campo.value = codigo;
    campo.setAttribute("readonly", "");
    campo.style.position = "fixed";
    campo.style.opacity = "0";
    document.body.appendChild(campo);
    campo.select();
    campo.setSelectionRange(0, codigo.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(campo);
    return ok;
  }

  async function copiar() {
    setFalhou(false);
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      return;
    } catch {
      // cai no plano B
    }
    if (copiarNaMarra()) setCopiado(true);
    else setFalhou(true);
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        onClick={() => void copiar()}
        // Verde só DEPOIS de copiar: a cor confirma que deu certo, e é o único
        // retorno que a pessoa tem — a área de transferência não se vê.
        variant={copiado ? "success" : "default"}
        className="h-14 w-full text-base"
      >
        {copiado ? (
          <>
            <Check className="mr-2 h-5 w-5" /> Código copiado
          </>
        ) : (
          <>
            <Copy className="mr-2 h-5 w-5" /> Copiar código Pix
          </>
        )}
      </Button>

      {/* O código à mostra é o plano B de quem não conseguiu copiar — e o
          jeito de conferir que copiou a coisa certa. Fica fechado por padrão
          porque 230 caracteres no meio da tela assustam. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
          Ver o código
        </summary>
        <p className="mt-2 break-all rounded border bg-slate-50 p-3 font-mono text-[11px] text-slate-700">
          {codigo}
        </p>
      </details>

      {falhou && (
        <p className="text-sm text-red-700">
          O navegador não deixou copiar. Abra &ldquo;Ver o código&rdquo; acima e copie à mão.
        </p>
      )}
    </div>
  );
}
