import { Building2, KeyRound, Users } from "lucide-react";
import { TituloSecao } from "./ui";

const PONTOS = [
  {
    icone: <Building2 size={20} aria-hidden />,
    titulo: "Conta isolada",
    texto:
      "Cada transportadora é uma conta separada — a divisão é uma trava automática no banco, não um filtro que alguém pode esquecer de aplicar.",
  },
  {
    icone: <Users size={20} aria-hidden />,
    titulo: "Um app, dois vínculos",
    texto:
      "O motorista que roda pra duas empresas usa um app só e troca de vínculo sem perder o que já lançou.",
  },
  {
    icone: <KeyRound size={20} aria-hidden />,
    titulo: "Acesso fatiado",
    texto:
      "110 permissões em 37 áreas: você monta o papel do conferente, do financeiro e do administrativo do jeito que a sua operação funciona.",
  },
];

export function MultiEmpresa() {
  return (
    <section className="secao border-t border-borda">
      <div className="caixa">
        <TituloSecao
          etiqueta="Multi-empresa"
          titulo="Mais de uma empresa no mesmo lugar, sem misturar"
        />
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl2 border border-borda bg-borda md:grid-cols-3">
          {PONTOS.map((p, i) => (
            <div
              key={p.titulo}
              className="revelar bg-superficie p-7"
              style={{ "--atraso": `${i * 70}ms` } as React.CSSProperties}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-azul-lavado text-azul">
                {p.icone}
              </span>
              <h3 className="mt-4 text-[1.1rem] font-semibold">{p.titulo}</h3>
              <p className="mt-2 text-[0.98rem] leading-relaxed text-tinta-media">
                {p.texto}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
