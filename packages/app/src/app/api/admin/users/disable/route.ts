import { adminDeps } from "@/lib/admin/deps.ts";
import { handleDisableUser } from "@/lib/admin/handlers.ts";

// 管理者だけが呼べる(入口の proxy と、ハンドラーの両方で確かめる)
export const POST = (request: Request) => handleDisableUser(request, adminDeps());
