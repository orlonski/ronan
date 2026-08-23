import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, X } from "lucide-react";
import { assinarSessoes, listarSessoes, sessaoAtiva } from "@/lib/sessoes";
import { sessoesComPendentes, trocarEmpresa } from "@/lib/troca-empresa";

type Linha = { motoristaId: string; contaNome: string; pendentes: number };

/**
 * Pra qual empresa ele está rodando AGORA.
 *
 * O motorista pode carregar de dia pra uma e de noite pra outra, e tudo que a
 * tela mostra — viagens, catálogo, pendentes — é da empresa selecionada aqui.
 * Por isso o seletor mora no topo: é o contexto de leitura de todo o resto.
 * Com uma empresa só (quase todo mundo), vira texto simples.
 */
export function SeletorEmpresa() {
  const qc = useQueryClient();
  const versao = useSyncExternalStore(assinarSessoes, () => JSON.stringify(listarSessoes()));
  const ativa = sessaoAtiva();
  const total = JSON.parse(versao).length as number;
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    void sessoesComPendentes().then((lista) =>
      setLinhas(
        lista.map((s) => ({
          motoristaId: s.motoristaId,
          contaNome: s.contaNome || "Empresa",
          pendentes: s.pendentes,
        })),
      ),
    );
  }, [aberto]);

  async function escolher(motoristaId: string) {
    setErro(null);
    try {
      await trocarEmpresa(qc, motoristaId);
      setAberto(false);
    } catch {
      // A troca não aconteceu: ele continua na empresa de antes (e o app segue
      // mostrando o dado dela, que é o certo). Só avisa por que não deu.
      setErro("Não deu pra trocar agora. Veja sua internet e tente de novo.");
    }
  }

  if (!ativa || (!ativa.contaNome && total <= 1)) return null;

  if (total <= 1) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/70">
        <Building2 size={14} />
        {ativa.contaNome}
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Trocar de empresa"
        className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm font-bold text-white active:opacity-70"
      >
        <Building2 size={14} />
        {ativa.contaNome || "Empresa"}
        <ChevronDown size={16} />
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-xl font-bold text-foreground">Você vai rodar pra quem?</h2>
            <button type="button" onClick={() => setAberto(false)} className="p-2">
              <X size={24} className="text-muted-foreground" />
            </button>
          </div>
          {erro && (
            <p className="mx-4 mt-4 rounded-2xl border-2 border-destructive/50 bg-destructive/10 p-4 text-base font-medium text-foreground">
              {erro}
            </p>
          )}
          <div className="flex flex-col gap-3 p-4">
            {linhas.map((l) => {
              const atual = l.motoristaId === ativa.motoristaId;
              return (
                <button
                  key={l.motoristaId}
                  type="button"
                  onClick={() => void escolher(l.motoristaId)}
                  className={`flex items-center gap-3 rounded-2xl border-2 p-4 text-left active:opacity-75 ${
                    atual ? "border-brand bg-brand/10" : "border-border bg-card"
                  }`}
                >
                  <Building2 size={22} className={atual ? "text-brand" : "text-muted-foreground"} />
                  <span className="flex-1">
                    <span className="block text-lg font-bold text-foreground">{l.contaNome}</span>
                    {l.pendentes > 0 && (
                      <span className="block text-sm font-medium text-amber-700">
                        {l.pendentes === 1
                          ? "1 lançamento esperando pra subir"
                          : `${l.pendentes} lançamentos esperando pra subir`}
                      </span>
                    )}
                  </span>
                  {atual && <Check size={22} className="text-brand" />}
                </button>
              );
            })}
          </div>
          <p className="px-5 text-sm text-muted-foreground">
            Cada empresa tem os lançamentos, os locais e os materiais dela. O que você faz numa
            não aparece na outra.
          </p>
        </div>
      )}
    </>
  );
}
