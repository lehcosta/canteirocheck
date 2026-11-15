import { migrar } from "../plataforma";

await migrar(process.env.DATABASE_URL_MIGRATOR);
console.log("✓ migrations aplicadas");
