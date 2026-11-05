import { authDeps } from "@/lib/auth/deps.ts";
import { handleConfirmSignUp } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleConfirmSignUp(request, authDeps());
