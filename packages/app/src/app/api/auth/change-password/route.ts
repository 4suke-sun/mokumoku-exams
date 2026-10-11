import { authDeps } from "@/lib/auth/deps.ts";
import { handleChangePassword } from "@/lib/auth/handlers.ts";

export const POST = (request: Request) => handleChangePassword(request, authDeps());
