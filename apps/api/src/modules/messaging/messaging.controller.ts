import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MessagingService } from './messaging.service';
import { OfferActionDto, SendMessageDto, StartThreadDto } from './dto/message.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types';

@ApiTags('Messaging')
@Controller('threads')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  listThreads(@CurrentUser() user: AuthUser) {
    return this.messaging.listThreads(user.id);
  }

  @Post()
  start(@CurrentUser() user: AuthUser, @Body() dto: StartThreadDto) {
    return this.messaging.startThread(dto.listingId, user.id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messaging.getMessages(id, user.id, cursor, limit ? Number(limit) : undefined);
  }

  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.messaging.sendMessage(id, user.id, dto);
  }

  @Post('messages/:messageId/offer')
  respondOffer(
    @CurrentUser() user: AuthUser,
    @Param('messageId') messageId: string,
    @Body() dto: OfferActionDto,
  ) {
    return this.messaging.respondToOffer(messageId, user.id, dto);
  }
}
