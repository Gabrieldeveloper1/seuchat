import { cors, fail } from "../_shared/util.ts";
// Fluxo legado desativado: decisões só pela identidade autorizada no case-desk.
Deno.serve((req) => req.method === "OPTIONS" ? new Response(null,{headers:cors}) : fail(410,"Use a central do administrador autenticado."));
