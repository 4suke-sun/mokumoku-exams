import { authDeps } from "@/lib/auth/deps.ts";
import { handleForgotPassword } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleForgotPassword(request, authDeps());
