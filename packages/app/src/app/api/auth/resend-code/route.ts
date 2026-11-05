import { authDeps } from "@/lib/auth/deps.ts";
import { handleResendCode } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleResendCode(request, authDeps());
