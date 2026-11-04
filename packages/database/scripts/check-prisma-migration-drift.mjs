import { execFileSync } from "node:child_process";

const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

if (!shadowDatabaseUrl) {
  console.error("SHADOW_DATABASE_URL is required for Prisma migration drift checks.");
  process.exit(1);
}

let diffSql;

try {
  diffSql = execFileSync(
    "prisma",
    [
      "migrate",
      "diff",
      "--from-migrations",
      "prisma/migrations",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--shadow-database-url",
      shadowDatabaseUrl,
      "--script",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
} catch (error) {
  process.exit(error.status ?? 1);
}

const normalizedDiff = diffSql.trim();

if (
  normalizedDiff === "" ||
  normalizedDiff === "-- This is an empty migration."
) {
  console.log("Prisma migration history matches schema.prisma.");
  process.exit(0);
}

console.error("Prisma migration drift detected.");
console.error(
  "Create a committed migration for schema.prisma changes instead of relying on prisma db push.",
);
console.error("");
console.error(normalizedDiff);
process.exit(1);
