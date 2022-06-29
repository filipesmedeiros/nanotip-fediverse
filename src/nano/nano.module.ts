import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { AccountsModule } from '@app/accounts/accounts.module'
import { Config } from '@app/lib/types'

import { NanoService } from './nano.service'

@Module({
  providers: [NanoService],
  exports: [NanoService],
  imports: [
    AccountsModule,
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService<Config>) => ({
        baseURL: configService.get('NANO_RPC_URL'),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class NanoModule {}
