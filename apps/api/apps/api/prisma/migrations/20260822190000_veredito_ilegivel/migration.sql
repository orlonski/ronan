-- Desfecho próprio pra foto que não dá pra ler.
--
-- Antes, três coisas diferentes viravam "leitura 0%" e caíam todas na fila de
-- revisão: resposta do modelo fora do formato (defeito de execução, que agora
-- retenta), foto ilegível (que precisa de foto NOVA, e nenhum conferente
-- resolve olhando a mesma foto borrada) e leitura fraca porém aproveitável
-- (essa sim, revisão humana).
--
-- Separar é o que permite dar a cada uma o desfecho que ela pede.

ALTER TYPE "VereditoConferencia" ADD VALUE 'ILEGIVEL';
