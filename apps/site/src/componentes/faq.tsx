import { ChevronDown } from "lucide-react";
import { TituloSecao } from "./ui";

export const PERGUNTAS = [
  {
    p: "Funciona sem internet?",
    r: "Funciona. O motorista lança viagem, pedágio, abastecimento e foto direto no aparelho, sem rede nenhuma. O app guarda numa fila e envia sozinho quando o sinal volta — e a tela de Pendentes mostra o que ainda não subiu. Falha de rede nunca vira erro que trava o lançamento.",
  },
  {
    p: "Precisa trocar de celular?",
    r: "Não. O app é nativo Android e iPhone e roda em aparelho comum. No iPhone também existe a versão web (PWA), que cobre lançar viagem, abastecimento, pedágio, OCR, pendentes e notificações — mas ela fica atrás do app nativo: stories, chat, viagem guiada, navegação por voz e diária existem só no nativo.",
  },
  {
    p: "Meus dados ficam onde?",
    r: "No Movatruck, dentro da conta da sua transportadora, isolada por trava automática no banco: dado de uma empresa não aparece pra outra. Você exporta viagens, abastecimentos e conferências em relatório a qualquer momento — o histórico é seu e sai de lá quando você quiser.",
  },
  {
    p: "O motorista é obrigado a usar?",
    r: "O lançamento acontece no app, então na prática ele é o caminho. Mas o app foi feito pro lado dele: ele guarda o próprio histórico, os próprios documentos, os próprios gastos, e o km que ele informa fica registrado do jeito dele. Na transportadora onde já roda, a adesão veio porque o app resolve a vida dele, não porque alguém mandou.",
  },
  {
    p: "Quanto custa e como eu começo?",
    r: "É assinatura mensal por operação. O valor sai na conversa, depois de ver quantos motoristas e quantos clientes embarcadores você tem — não faz sentido chutar preço sem isso. O começo é uma demonstração de 30 minutos com o painel real na tela; se fizer sentido, a gente cadastra sua empresa, seus materiais e seus clientes e o primeiro motorista já lança no mesmo dia.",
  },
  {
    p: "Dá pra usar em iPhone?",
    r: "Dá. Tem app nativo pra iPhone e também a versão web, que abre no Safari sem passar pela loja. A versão web não tem tudo que o nativo tem — a lista completa da diferença a gente mostra na demonstração, sem enrolação.",
  },
  {
    p: "Preciso instalar servidor?",
    r: "Não. O painel abre no navegador e o app vem das lojas. Você não instala nada, não contrata infraestrutura e não depende de TI interna pra subir o sistema.",
  },
  {
    p: "E se o motorista errar o lançamento?",
    r: "Erro se conserta. O painel corrige, mas o km faturado só muda com motivo escrito — sem motivo, o sistema recusa, e o que passa vira registro de auditoria com autor e data. Ticket que não bate com o lançado cai numa fila de conferência pra uma pessoa olhar, nunca vira desconto automático. E lançamento que o app não conseguiu enviar aparece inteiro no painel, pronto pra recuperar.",
  },
];

export function Faq() {
  return (
    <section id="perguntas" className="secao border-t border-borda">
      <div className="caixa grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] lg:gap-16">
        <TituloSecao
          etiqueta="Perguntas"
          titulo="O que perguntam antes de fechar"
        />

        <div className="regua">
          {PERGUNTAS.map((item, i) => (
            <details
              key={item.p}
              className="revelar group border-b border-borda"
              style={{ "--atraso": `${i * 45}ms` } as React.CSSProperties}
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[1.03rem] font-semibold text-tinta [&::-webkit-details-marker]:hidden">
                {item.p}
                <ChevronDown
                  size={20}
                  aria-hidden
                  className="flex-none text-tinta-fraca transition-transform duration-300 ease-patio group-open:rotate-180"
                />
              </summary>
              <p className="pb-5 pr-8 text-[0.99rem] leading-relaxed text-tinta-media">
                {item.r}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
