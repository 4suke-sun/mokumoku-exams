import { authDeps } from "@/lib/auth/deps.ts";
import { handleLogin } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleLogin(request, authDeps());
