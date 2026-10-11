import { authDeps } from "@/lib/auth/deps.ts";
import { handleResetPassword } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleResetPassword(request, authDeps());
