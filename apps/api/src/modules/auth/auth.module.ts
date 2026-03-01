import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { AppleStrategy } from './strategies/apple.strategy';
import { WebAuthnService } from './webauthn.service';
import { RedisService } from './redis.service';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { CoopsModule } from '../coops/coops.module';

// Only register OAuth strategies if credentials are configured
const conditionalProviders: any[] = [];
if (process.env.GOOGLE_CLIENT_ID) {
  conditionalProviders.push(GoogleStrategy);
}
if (process.env.APPLE_CLIENT_ID) {
  conditionalProviders.push(AppleStrategy);
}

@Module({
  imports: [
    UsersModule,
    PassportModule,
    EmailModule,
    CoopsModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LocalStrategy,
    WebAuthnService,
    RedisService,
    ...conditionalProviders,
  ],
  exports: [AuthService],
})
export class AuthModule {}
