import { resetarBanco } from "../plataforma";

await resetarBanco(process.env.DATABASE_URL_MIGRATOR);
console.log("✓ banco zerado (schema public recriado)");
