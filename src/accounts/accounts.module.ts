import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { NanoModule } from '@app/nano/nano.module'
import { PrismaModule } from '@app/prisma/prisma.module'

import { AccountsService } from './accounts.service'

@Module({
  providers: [AccountsService],
  exports: [AccountsService],
  imports: [ConfigModule, PrismaModule, NanoModule],
})
export class AccountsModule {}
