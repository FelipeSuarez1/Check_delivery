import { redirect } from "next/navigation";
import { lerSessaoVerificada } from "@/lib/auth";
import { ROTA_INICIAL } from "@/lib/papeis";

/**
 * "/" não tem tela: o middleware já manda cada papel para a sua inicial. Este
 * redirect cobre o caso do middleware ter deixado passar (defesa em profundidade).
 */
export default async function Home() {
  const sessao = await lerSessaoVerificada();
  redirect(sessao ? ROTA_INICIAL[sessao.papel] : "/login");
}
