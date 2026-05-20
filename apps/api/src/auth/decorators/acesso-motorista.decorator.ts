import { SetMetadata } from "@nestjs/common";
import { ACESSO_KEY, type AcessoFlag } from "../guards/acesso-motorista.guard";

export const AcessoMotorista = (flag: AcessoFlag) => SetMetadata(ACESSO_KEY, flag);
