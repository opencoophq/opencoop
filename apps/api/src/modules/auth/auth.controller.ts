import { Controller, Post, Put, Body, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateUpgradeTokenDto, UpgradeToAdultDto } from './dto/upgrade-to-adult.dto';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({ status: 200, description: 'Reset email sent if account exists' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Public()
  @Post('reset-password')
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
    @Body() body: { preferredLanguage?: string },
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
  @ApiOperation({ summary: 'Convert minor shareholder to adult with new account' })
  @ApiResponse({ status: 201, description: 'Account created, shareholder upgraded' })
  @ApiResponse({ status: 400, description: 'Invalid token or validation error' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async upgradeToAdult(@Body() upgradeDto: UpgradeToAdultDto) {
    return this.authService.upgradeMinorToAdult(upgradeDto);
  }

  @Public()
  @Post('magic-link/request')
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
}
