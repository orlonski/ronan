-- Material declarado != material do ticket. Era o caso que mais caía em
-- `OUTRO` (o motorista escolhe o material na lista antes de ver o papel, e a
-- conferência automática detecta a diferença sozinha) — sem tipo próprio ele
-- só via um texto e tinha que editar a viagem inteira. Com o tipo, os apps
-- mostram card dedicado: escolhe o material certo e explica.
ALTER TYPE "TipoDivergencia" ADD VALUE 'MATERIAL_DIVERGENTE';
