import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@opencoop/database';
import { hashToken } from '../../common/crypto/hash-token';
import { createTestPrisma, describeDb } from '../../test-utils/test-db';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

const SECRET = 'db-test-only-secret';

describeDb('session revocation (database)', () => {
  let prisma: PrismaClient;
  let tokens: TokenService;
  let jwt: JwtService;
  let strategy: JwtStrategy;
  const createdUserIds: string[] = [];

  beforeAll(() => {
    prisma = createTestPrisma();
    jwt = new JwtService({ secret: SECRET });
    tokens = new TokenService(prisma as never, jwt);
    strategy = new JwtStrategy({ get: () => SECRET } as never, prisma as never);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  async function createUser() {
    const user = await prisma.user.create({
      data: { email: `revocation-${Date.now()}-${createdUserIds.length}@dbtest.invalid` },
    });
    createdUserIds.push(user.id);
    return { ...user, coopAdminOf: [] };
  }

  const validate = (accessToken: string) => strategy.validate(jwt.verify(accessToken));

  it('defaults sessionVersion to 0 and signs it into the token', async () => {
    const user = await createUser();
    expect(user.sessionVersion).toBe(0);
    const session = await tokens.issueJwtForUser(user);
    expect(jwt.decode(session.accessToken!)).toMatchObject({ sv: 0 });
    await expect(validate(session.accessToken!)).resolves.toMatchObject({ id: user.id });
  });

  it('kills access and refresh tokens on revokeAllSessions', async () => {
    const user = await createUser();
    const session = await tokens.issueJwtForUser(user);
    await tokens.revokeAllSessions(user.id);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion).toBe(1);
    await expect(validate(session.accessToken!)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(tokens.refreshAccessToken(session.refreshToken!)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const next = await tokens.issueJwtForUser(user);
    expect(jwt.decode(next.accessToken!)).toMatchObject({ sv: 1 });
    await expect(validate(next.accessToken!)).resolves.toMatchObject({ id: user.id });
  });

  it('rejects the access token of a deleted user, and its refresh token is gone', async () => {
    const user = await createUser();
    const session = await tokens.issueJwtForUser(user);
    await prisma.user.delete({ where: { id: user.id } });

    await expect(validate(session.accessToken!)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(tokens.refreshAccessToken(session.refreshToken!)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('never leaves a live refresh row from a login that races a revocation', async () => {
    const user = await createUser();
    for (let round = 0; round < 10; round++) {
      const [issued] = await Promise.all([
        tokens.issueJwtForUser(user),
        tokens.revokeAllSessions(user.id),
      ]);
      const { sessionVersion } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const signed = (jwt.decode(issued.accessToken!) as { sv: number }).sv;
      const row = await prisma.refreshToken.findUniqueOrThrow({
        where: { tokenHash: hashToken(issued.refreshToken!) },
      });
      // Either the login came first and the revocation revoked its row, or
      // it came second and its token carries the new version. A live row
      // with a stale version would mint tokens past the revocation.
      if (row.revokedAt === null) {
        expect(signed).toBe(sessionVersion);
      } else {
        expect(signed).toBeLessThan(sessionVersion);
      }
    }
  });
});
