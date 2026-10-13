import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultConfigPath } from "./config.ts";
import { main } from "./main.ts";

// 環境値は .env(gitignore 済み)から読む。なくてもよい
const envFile = resolve(import.meta.dirname, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.exit(
  main({
    argv: process.argv.slice(2),
    env: process.env,
    output: { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) },
    configPath: defaultConfigPath(),
  }),
);
