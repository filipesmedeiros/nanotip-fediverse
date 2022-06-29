import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { AccountsModule } from '@app/accounts/accounts.module'
import { Config } from '@app/lib/types'

import { MastodonService } from './mastodon.service'

@Module({
  providers: [MastodonService],
  exports: [MastodonService],
  imports: [
    AccountsModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService<Config>) => ({
        baseURL: configService.get('MASTODON_REST_BASE_URL'),
        headers: {
          Authorization: `Bearer ${configService.get('MASTODON_ACCESS_TOKEN')}`,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class MastodonModule {}
