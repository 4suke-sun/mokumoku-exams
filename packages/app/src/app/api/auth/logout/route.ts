import { authDeps } from "@/lib/auth/deps.ts";
import { handleLogout } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleLogout(request, authDeps());
