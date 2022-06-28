import { Module } from '@nestjs/common'

import { MastodonModule } from '@app/mastodon/mastodon.module'
import { PrismaModule } from '@app/prisma/prisma.module'
import { NanoModule } from './nano/nano.module';

@Module({
  imports: [MastodonModule, PrismaModule, NanoModule],
})
export class AppModule {}
