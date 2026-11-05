import { deleteAccountDeps } from "@/lib/auth/account-deps.ts";
import { handleDeleteAccount } from "@/lib/auth/handlers.ts";

// ログインが要る(入口の proxy と、ハンドラーの両方で確かめる)
export const POST = (request: Request) => handleDeleteAccount(request, deleteAccountDeps());
