import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { Config } from '@app/lib/types'
import { PrismaModule } from '@app/prisma/prisma.module'

import { MastodonService } from './mastodon.service'

@Module({
  providers: [MastodonService],
  exports: [MastodonService],
  imports: [
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
    PrismaModule,
  ],
})
export class MastodonModule {}
