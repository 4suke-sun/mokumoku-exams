import { authDeps } from "@/lib/auth/deps.ts";
import { handleNewPassword } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleNewPassword(request, authDeps());
