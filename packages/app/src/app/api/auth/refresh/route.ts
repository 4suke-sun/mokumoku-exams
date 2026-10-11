import { authDeps } from "@/lib/auth/deps.ts";
import { handleRefresh } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleRefresh(request, authDeps());
