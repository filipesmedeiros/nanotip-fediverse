import { HttpService } from '@nestjs/axios'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Big from 'big.js'
import { JSDOM } from 'jsdom'
import { Unit, convert } from 'nanocurrency'
import { MessageEvent, WebSocket } from 'ws'

import { Config } from '@app/lib/types'
import { Account, Toot } from '@app/mastodon/lib/mastodon.types'
import { NanoService } from '@app/nano/nano.service'
import { PrismaService } from '@app/prisma/prisma.service'

@Injectable()
export class MastodonService implements OnModuleInit {
  private ws: WebSocket
  private mastodonStreamingBaseUrlWithToken: string
  private readonly logger = new Logger(MastodonService.name)

  constructor(
    private httpService: HttpService,
    private configService: ConfigService<Config>,
    private prismaService: PrismaService,
    private nanoService: NanoService
  ) {
    this.mastodonStreamingBaseUrlWithToken = `${this.configService.get(
      'MASTODON_STREAMING_BASE_URL'
    )}?access_token=${this.configService.get('MASTODON_ACCESS_TOKEN')}`
  }

  private async onToot(toot: Toot) {
    try {
      const { amount, isCustodial } = this.parseToot(toot.content)

      const amountInRaw = convert(amount.toString(), {
        from: Unit.Nano,
        to: Unit.raw,
      })

      if (!isCustodial) return // TODO

      const tipperAccount = await this.prismaService.account.findUnique({
        where: { fediverseAccountId: toot.account.id },
      })

      if (!tipperAccount) {
        this.logger.warn(
          `Mastodon user ${toot.account.id} has not created an account yet`
        )
        this.toot('You have not created an account yet 🥲', toot.id) // TODO
      }

      const { balance } = await this.nanoService.getNanoAccountInfo(
        tipperAccount.nanoAddress
      )

      if (Big(amountInRaw).gt(balance)) {
        this.logger.warn(
          `Mastodon user ${toot.account.id} doesn't have enough balance to tip requested amount`
        )
        this.toot("You don't have enough balance in your account 🥲", toot.id) // TODO
      }

      const replyToAccountId = toot.in_reply_to_account_id
      const isReply = !!replyToAccountId

      if (isReply) {
        const repliantMastodonAccount = await this.getMastodonAccount(
          replyToAccountId
        )
        const sendToAddress = repliantMastodonAccount.fields.find(
          ({ name }) => {
            const nameLower = name.toLocaleUpperCase()
            return (
              nameLower === 'XNO' || nameLower === 'NANO' || nameLower === 'Ӿ'
            )
          }
        )?.value

        if (!sendToAddress) {
          let repliantAccount = await this.prismaService.account.findUnique({
            where: { fediverseAccountId: replyToAccountId },
          })

          if (!repliantAccount) {
            const index =
              (
                await this.prismaService.account.findFirst({
                  orderBy: { nanoIndex: 'desc' },
                })
              )?.nanoIndex ?? 0
            const { address } = this.nanoService.getAddressAndPkFromIndex(index)
            repliantAccount = await this.prismaService.account.create({
              data: {
                fediverseAccountId: replyToAccountId,
                nanoIndex: index,
                nanoAddress: address,
              },
            })
          }

          const { privateKey } = this.nanoService.getAddressAndPkFromIndex(
            repliantAccount.nanoIndex
          )

          const hash = await this.nanoService.sendNano({
            amount: amountInRaw,
            from: tipperAccount.nanoAddress,
            to: repliantAccount.nanoAddress,
            privateKey,
          })

          this.toot(
            `<p>Created an <a href="https://nanolooker.com/account/${repliantAccount.nanoAddress}">account</a> for ${repliantMastodonAccount.display_name}</p>
                    <p>and <a href="https://nanolooker.com/block/${hash}">sent</a> Ӿ${amount} to it! ⚡️</p>`,
            toot.id
          )
        }
      } else {
      }
    } catch (e) {
      this.logger.error(e)
      return
    }
  }

  onModuleInit() {
    this.listenToToots(this.onToot)
  }

  async toot(status: string, inReplyTo?: string) {
    const tootRes = await this.httpService.axiosRef.post<Toot>('/statuses', {
      status,
      in_reply_to_id: inReplyTo,
    })

    if (tootRes.status >= 300) throw new Error(tootRes.statusText)

    return tootRes.data
  }

  parseToot(rawContent: string) {
    const content = new JSDOM(rawContent)
    const firstLine = content.window.document.querySelector('p')
    const textContent = firstLine?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const parts = textContent.split(' ')
    const amount = parts.find(part => !isNaN(+part) && +part !== 0)

    if (!amount) throw new Error('Toot is badly formatted')

    const isCustodial = !parts.includes('non-custodial')

    return { amount: +amount, isCustodial }
  }

  async getMastodonAccount(id: string) {
    const accountRes = await this.httpService.axiosRef.get<Account>(
      `/accounts/${id}`
    )

    if (accountRes.status >= 300) throw new Error(accountRes.statusText)

    return accountRes.data
  }

  listenToToots(onToot: (toot: Toot) => void, tag?: string) {
    const wsUrl = tag
      ? `${
          this.mastodonStreamingBaseUrlWithToken
        }&stream=hashtag&tag=${this.configService.get(
          'MASTODON_TRIGGER_HASHTAG'
        )}`
      : `${this.mastodonStreamingBaseUrlWithToken}&stream=public`

    const messageHandler = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return

      const data = JSON.parse(ev.data as string)
      if (data.event !== 'update') return

      const toot = JSON.parse(data.payload)

      onToot(toot)
    }

    this.ws = new WebSocket(wsUrl)

    this.ws.onclose = () => (this.ws = new WebSocket(wsUrl))
    this.ws.onopen = () => this.ws.addEventListener('message', messageHandler)
  }
}
