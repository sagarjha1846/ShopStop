import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService, type AuthContext, type TokenPair } from './auth.service';
import { LoginDto, OtpRequestDto, OtpVerifyDto, RegisterDto, VerifyEmailDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AppConfigService } from '../../config/config.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthUser } from './types';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.register(dto, this.ctx(req));
    this.setRefreshCookie(res, tokens.refreshToken);
    return this.authResult(user, tokens);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(dto, this.ctx(req));
    this.setRefreshCookie(res, tokens.refreshToken);
    return this.authResult(user, tokens);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? undefined;
    if (!token) throw new AppError('UNAUTHENTICATED', 'Missing refresh token');
    const tokens = await this.auth.refresh(token, this.ctx(req));
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Best-effort: derive sid from the refresh cookie if present.
    this.clearRefreshCookie(res);
    await this.auth.logoutAll(user.id);
  }

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  async otpRequest(@Body() dto: OtpRequestDto) {
    await this.auth.requestOtp(dto.phone);
    return { status: 'sent' };
  }

  @Post('otp/verify')
  @HttpCode(200)
  async otpVerify(@CurrentUser() user: AuthUser, @Body() dto: OtpVerifyDto) {
    const updated = await this.auth.verifyOtp(user.id, dto.phone, dto.code);
    return { user: updated };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { status: 'verified' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  // ---- helpers ----

  private ctx(req: Request): AuthContext {
    return {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceFingerprint: (req.headers['x-device-fingerprint'] as string) ?? undefined,
    };
  }

  private authResult(user: AuthUser, tokens: TokenPair) {
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user };
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.get('JWT_REFRESH_TTL') * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }
}
