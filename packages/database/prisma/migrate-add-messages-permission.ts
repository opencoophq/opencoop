/**
 * One-time migration: Add canManageMessages to all existing CoopRole permissions.
 *
 * Roles that already have canManageDividends: true get canManageMessages: true.
 * All other roles get canManageMessages: false.
 *
 * Usage: npx tsx packages/database/prisma/migrate-add-messages-permission.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.coopRole.findMany();

  let updated = 0;
  for (const role of roles) {
    const perms = role.permissions as Record<string, boolean>;

    if ('canManageMessages' in perms) {
      console.log(`  SKIP ${role.name} (coop ${role.coopId}) — already has canManageMessages`);
      continue;
    }

    // Only enable for "Admin" roles — GDPR Admin can see names via messages
    const shouldEnable = role.name === 'Admin';
    const newPerms = { ...perms, canManageMessages: shouldEnable };

    await prisma.coopRole.update({
      where: { id: role.id },
      data: { permissions: newPerms },
    });

    console.log(`  SET  ${role.name} (coop ${role.coopId}) → canManageMessages: ${shouldEnable}`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} of ${roles.length} roles.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
