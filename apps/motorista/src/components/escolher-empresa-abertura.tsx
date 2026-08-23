import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { MovatruckLogo } from "@/components/movatruck-logo";
import { marcarEmpresaEscolhida, motoristaAtivoId } from "@/lib/sessoes";
import { sessoesComPendentes, trocarEmpresa } from "@/lib/troca-empresa";

type Linha = { motoristaId: string; contaNome: string; pendentes: number };

/**
 * Tela de abertura de quem roda pra mais de uma empresa: pra qual vai trabalhar
 * hoje. Aparece uma vez por abertura do app, antes de qualquer tela — lançar
 * viagem na empresa errada é um estrago chato de desfazer. Quem tem uma empresa
 * só nunca vê isto.
 */
export function EscolherEmpresaAbertura() {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const ativa = motoristaAtivoId();

  useEffect(() => {
    void sessoesComPendentes().then((lista) =>
      setLinhas(
        lista.map((s) => ({
          motoristaId: s.motoristaId,
          contaNome: s.contaNome || "Empresa",
          pendentes: s.pendentes,
        })),
      ),
    );
  }, []);

  async function escolher(motoristaId: string) {
    setErro(null);
    try {
      await trocarEmpresa(qc, motoristaId);
      marcarEmpresaEscolhida();
    } catch {
      // Não entrou na empresa (faltou o token dela e não deu pra pedir outro
      // agora). Segue perguntando: passar direto abriria o app na empresa
      // errada — justamente o que esta tela existe pra impedir.
      setErro("Não deu pra abrir essa empresa agora. Veja sua internet e tente de novo.");
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background">
      <div className="bg-brand px-6 pb-8 pt-safe">
        <div className="pt-12">
          <MovatruckLogo />
          <p className="mt-2 text-base font-medium text-white/80">Bom dia! Vamos começar.</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-6">
        <h2 className="text-2xl font-bold text-foreground">Você vai rodar pra quem hoje?</h2>
        <p className="mb-2 text-base text-muted-foreground">
          Tudo que você lançar vai pra empresa escolhida. Dá pra trocar depois, lá no topo da
          tela inicial.
        </p>
        {erro && (
          <p className="rounded-2xl border-2 border-destructive/50 bg-destructive/10 p-4 text-base font-medium text-foreground">
            {erro}
          </p>
        )}
        {linhas.map((l) => (
          <button
            key={l.motoristaId}
            type="button"
            onClick={() => void escolher(l.motoristaId)}
            className={`flex items-center gap-3 rounded-2xl border-2 p-5 text-left active:opacity-75 ${
              l.motoristaId === ativa ? "border-brand bg-brand/10" : "border-border bg-card"
            }`}
          >
            <Building2 size={26} className="text-brand" />
            <span className="flex-1">
              <span className="block text-xl font-bold text-foreground">{l.contaNome}</span>
              {l.pendentes > 0 && (
                <span className="block text-sm font-medium text-amber-700">
                  {l.pendentes === 1
                    ? "1 lançamento esperando pra subir"
                    : `${l.pendentes} lançamentos esperando pra subir`}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
