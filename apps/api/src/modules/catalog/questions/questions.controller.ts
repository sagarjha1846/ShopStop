import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { QuestionsService } from './questions.service';
import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '../../auth/types';

class AskDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  body!: string;
}

class AnswerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;
}

@ApiTags('Listings')
@Controller()
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  /** Public: the answers are the point — they should be readable before sign-up. */
  @Public()
  @Get('listings/:id/questions')
  list(@Param('id') id: string) {
    return this.questions.list(id);
  }

  @Post('listings/:id/questions')
  ask(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AskDto) {
    return this.questions.ask(user.id, id, dto.body);
  }

  @Post('questions/:questionId/answer')
  answer(@CurrentUser() user: AuthUser, @Param('questionId') questionId: string, @Body() dto: AnswerDto) {
    return this.questions.answer(user.id, questionId, dto.body);
  }

  @Roles(UserRole.ADMIN, UserRole.MODERATOR)
  @Post('admin/questions/:questionId/hide')
  async hide(@Param('questionId') questionId: string) {
    await this.questions.hide(questionId);
    return { ok: true };
  }
}
