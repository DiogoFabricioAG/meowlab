-- Rol del usuario del portal: "user" o "admin" (lo asigna el operador).
ALTER TABLE "user" ADD COLUMN "role" text NOT NULL DEFAULT 'user';
