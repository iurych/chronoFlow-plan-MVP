import { Elysia } from "elysia";
import { authRoutes } from "./modules/auth/routes";

const port = Number(process.env.PORT ?? 3000);

const app = new Elysia()
  .get("/health", () => ({ status: "ok", service: "chronoflow-api" }))
  .use(authRoutes)
  .listen(port);

console.log(`ChronoFlow API rodando em http://${app.server?.hostname}:${app.server?.port}`);
