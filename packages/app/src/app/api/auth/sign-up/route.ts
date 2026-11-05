import { signUpDeps } from "@/lib/auth/deps.ts";
import { handleSignUp } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleSignUp(request, signUpDeps());
