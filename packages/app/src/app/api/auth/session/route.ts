import { authDeps } from "@/lib/auth/deps.ts";
import { handleSession } from "@/lib/auth/handlers.ts";

export const GET = (request: Request) => handleSession(request, authDeps());
