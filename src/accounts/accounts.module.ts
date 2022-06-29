import { Module, forwardRef } from '@nestjs/common'

import { NanoModule } from '@app/nano/nano.module'
import { PrismaModule } from '@app/prisma/prisma.module'

import { AccountsService } from './accounts.service'

@Module({
  providers: [AccountsService],
  exports: [AccountsService],
  imports: [PrismaModule, forwardRef(() => NanoModule)],
})
export class AccountsModule {}
