import { Controller, DefaultValuePipe, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { SearchService, type SearchResult } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'search' })
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@CurrentUser() user: AuthenticatedUser, @Query('q', new DefaultValuePipe('')) q: string): Promise<SearchResult[]> {
    return this.search.search(user.tenantId, user.permissions, q);
  }
}
