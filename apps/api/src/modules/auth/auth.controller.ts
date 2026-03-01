import { Controller, Post, Put, Body, Get, Query, UseGuards, Delete, Param, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ValidateUpgradeTokenDto, UpgradeToAdultDto } from './dto/upgrade-to-adult.dto';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { WaitlistDto } from './dto/waitlist.dto';
import { MfaEnableDto, MfaVerifyDto, MfaDisableDto } from './dto/mfa.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WebAuthnService } from './webauthn.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { AppleAuthGuard } from './guards/apple-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly webAuthnService: WebAuthnService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('onboarding')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Register user and create a new cooperative' })
  @ApiResponse({ status: 201, description: 'User and cooperative created successfully' })
  @ApiResponse({ status: 409, description: 'Email or slug already in use' })
  async onboard(@Body() onboardingDto: OnboardingDto) {
    return this.authService.onboard(onboardingDto);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('forgot-password')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({ status: 200, description: 'Reset email sent if account exists' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Public()
  @Post('reset-password')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Public()
  @Get('verify-email')
  @ApiOperation({ summary: 'Verify email address' })
  @ApiResponse({ status: 200, description: 'Email verified' })
  @ApiResponse({ status: 400, description: 'Invalid token' })
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-verification')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  async resendVerification(@CurrentUser() user: CurrentUserData) {
    return this.authService.resendVerificationEmail(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  async getProfile(@CurrentUser() user: CurrentUserData) {
    return this.authService.getProfile(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user preferences' })
  @ApiResponse({ status: 200, description: 'User preferences updated' })
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change current user password' })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'Current password incorrect' })
  async changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      user.id,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }

  @Public()
  @Get('validate-upgrade-token')
  @ApiOperation({ summary: 'Validate a minor-to-adult upgrade token' })
  @ApiResponse({ status: 200, description: 'Token is valid, returns shareholder info' })
  @ApiResponse({ status: 400, description: 'Token is invalid, expired, or already used' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async validateUpgradeToken(@Query('token') token: string) {
    return this.authService.validateUpgradeToken(token);
  }

  @Public()
  @Post('upgrade-to-adult')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Convert minor shareholder to adult with new account' })
  @ApiResponse({ status: 201, description: 'Account created, shareholder upgraded' })
  @ApiResponse({ status: 400, description: 'Invalid token or validation error' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async upgradeToAdult(@Body() upgradeDto: UpgradeToAdultDto) {
    return this.authService.upgradeMinorToAdult(upgradeDto);
  }

  @Public()
  @Post('magic-link/request')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Request a magic link login email' })
  @ApiResponse({ status: 200, description: 'If an account exists, a login link has been sent' })
  async requestMagicLink(@Body() requestMagicLinkDto: RequestMagicLinkDto) {
    return this.authService.requestMagicLink(requestMagicLinkDto);
  }

  @Public()
  @Post('magic-link/verify')
  @ApiOperation({ summary: 'Verify magic link token and login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Invalid, expired, or already used token' })
  async verifyMagicLink(@Body() verifyMagicLinkDto: VerifyMagicLinkDto) {
    return this.authService.verifyMagicLink(verifyMagicLinkDto);
  }

  // ============================================================================
  // MFA / TOTP
  // ============================================================================

  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate TOTP secret and QR code for MFA setup' })
  @ApiResponse({ status: 200, description: 'QR code and secret returned' })
  async mfaSetup(@CurrentUser() user: CurrentUserData) {
    return this.authService.mfaSetup(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify TOTP code and enable MFA' })
  @ApiResponse({ status: 200, description: 'MFA enabled, recovery codes returned' })
  async mfaEnable(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MfaEnableDto,
  ) {
    return this.authService.mfaEnable(user.id, dto.code);
  }

  @Public()
  @Post('mfa/verify')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Verify TOTP or recovery code during login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  async mfaVerify(@Body() dto: MfaVerifyDto) {
    return this.authService.mfaVerify(dto.mfaToken, dto.code, dto.recoveryCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable MFA (requires password confirmation)' })
  @ApiResponse({ status: 200, description: 'MFA disabled' })
  async mfaDisable(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MfaDisableDto,
  ) {
    return this.authService.mfaDisable(user.id, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/recovery-codes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate MFA recovery codes' })
  @ApiResponse({ status: 200, description: 'New recovery codes returned' })
  async mfaRegenerateRecoveryCodes(@CurrentUser() user: CurrentUserData) {
    return this.authService.mfaRegenerateRecoveryCodes(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mfa/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get MFA status' })
  @ApiResponse({ status: 200, description: 'MFA status returned' })
  async mfaStatus(@CurrentUser() user: CurrentUserData) {
    return this.authService.mfaStatus(user.id);
  }

  // ============================================================================
  // WEBAUTHN / PASSKEYS
  // ============================================================================

  @UseGuards(JwtAuthGuard)
  @Post('webauthn/register-options')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate WebAuthn registration options' })
  async webauthnRegisterOptions(@CurrentUser() user: CurrentUserData) {
    return this.webAuthnService.generateRegistrationOptions(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('webauthn/register-verify')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify WebAuthn registration response' })
  async webauthnRegisterVerify(
    @CurrentUser() user: CurrentUserData,
    @Body() body: { response: Record<string, unknown>; friendlyName?: string },
  ) {
    return this.webAuthnService.verifyRegistration(user.id, body.response as any, body.friendlyName);
  }

  @Public()
  @Post('webauthn/authenticate-options')
  @ApiOperation({ summary: 'Generate WebAuthn authentication options' })
  async webauthnAuthenticateOptions(@Body() body: { email?: string }) {
    return this.webAuthnService.generateAuthenticationOptions(body.email);
  }

  @Public()
  @Post('webauthn/authenticate-verify')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Verify WebAuthn authentication response' })
  async webauthnAuthenticateVerify(@Body() body: { response: Record<string, unknown> }) {
    const user = await this.webAuthnService.verifyAuthentication(body.response as any);
    return this.authService.issueJwtForUserPublic(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('webauthn/credentials')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List registered passkeys' })
  async webauthnListCredentials(@CurrentUser() user: CurrentUserData) {
    return this.webAuthnService.listCredentials(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('webauthn/credentials/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a registered passkey' })
  async webauthnDeleteCredential(
    @CurrentUser() user: CurrentUserData,
    @Param('id') credentialId: string,
  ) {
    return this.webAuthnService.deleteCredential(user.id, credentialId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('webauthn/credentials/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rename a passkey' })
  async webauthnRenameCredential(
    @CurrentUser() user: CurrentUserData,
    @Param('id') credentialId: string,
    @Body() body: { friendlyName: string },
  ) {
    return this.webAuthnService.renameCredential(user.id, credentialId, body.friendlyName);
  }

  // ============================================================================
  // GOOGLE OAUTH
  // ============================================================================

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  async googleLogin() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(@Req() req: any, @Res() res: any) {
    const { googleId, email, name } = req.user;
    const result = await this.authService.handleOAuthLogin('google', {
      providerId: googleId,
      email,
      name,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';

    if ('requiresMfa' in result && result.requiresMfa) {
      return res.redirect(`${frontendUrl}/oauth-callback?mfaToken=${result.mfaToken}`);
    }

    const tokenData = encodeURIComponent(JSON.stringify(result));
    return res.redirect(`${frontendUrl}/oauth-callback?data=${tokenData}`);
  }

  // ============================================================================
  // APPLE OAUTH
  // ============================================================================

  @Public()
  @Get('apple')
  @UseGuards(AppleAuthGuard)
  @ApiOperation({ summary: 'Initiate Apple OAuth login' })
  async appleLogin() {
    // Guard redirects to Apple
  }

  @Public()
  @Post('apple/callback')
  @UseGuards(AppleAuthGuard)
  @ApiOperation({ summary: 'Apple OAuth callback (POST)' })
  async appleCallback(@Req() req: any, @Res() res: any) {
    const { appleId, email, name } = req.user;
    const result = await this.authService.handleOAuthLogin('apple', {
      providerId: appleId,
      email,
      name,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';

    if ('requiresMfa' in result && result.requiresMfa) {
      return res.redirect(`${frontendUrl}/oauth-callback?mfaToken=${result.mfaToken}`);
    }

    const tokenData = encodeURIComponent(JSON.stringify(result));
    return res.redirect(`${frontendUrl}/oauth-callback?data=${tokenData}`);
  }

  @Public()
  @Post('waitlist')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'Join the waitlist with email' })
  @ApiResponse({ status: 201, description: 'Successfully joined the waitlist' })
  async joinWaitlist(@Body() waitlistDto: WaitlistDto) {
    return this.authService.joinWaitlist(waitlistDto);
  }
}
