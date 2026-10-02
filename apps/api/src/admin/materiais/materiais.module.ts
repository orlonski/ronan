import { Module } from "@nestjs/common";
import { MateriaisController } from "./materiais.controller";
import { MateriaisService } from "./materiais.service";
import { TabelasPrecoModule } from "../tabelas-preco/tabelas-preco.module";

@Module({
  // A densidade do material alimenta o preço por m³: cadastrá-la precifica as
  // viagens que estavam paradas esperando por ela.
  imports: [TabelasPrecoModule],
  controllers: [MateriaisController],
  providers: [MateriaisService],
})
export class MateriaisModule {}
