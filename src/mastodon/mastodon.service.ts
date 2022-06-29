import { HttpService } from '@nestjs/axios'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Big from 'big.js'
import { JSDOM } from 'jsdom'
import { Unit, convert } from 'nanocurrency'
import { MessageEvent, WebSocket } from 'ws'

import { AccountsService } from '@app/accounts/accounts.service'
import { Config } from '@app/lib/types'
import { Account, Toot } from '@app/mastodon/lib/mastodon.types'
import { NanoService } from '@app/nano/nano.service'

@Injectable()
export class MastodonService implements OnModuleInit {
  private ws: WebSocket
  private mastodonStreamingBaseUrlWithToken: string
  private readonly logger = new Logger(MastodonService.name)

  constructor(
    private httpService: HttpService,
    private configService: ConfigService<Config>,
    private nanoService: NanoService,
    private accountsService: AccountsService
  ) {
    this.mastodonStreamingBaseUrlWithToken = `${this.configService.get(
      'MASTODON_STREAMING_BASE_URL'
    )}?access_token=${this.configService.get('MASTODON_ACCESS_TOKEN')}`
  }

  private tootCreatedAccountAndTipped({
    replyToTootId,
    newNanoAccount,
    blockHash,
    tippedUserDisplayName,
    amount,
  }: {
    replyToTootId: string
    newNanoAccount: string
    tippedUserDisplayName: string
    blockHash: string
    amount: number
  }) {
    this.toot(
      `Created an account (https://nanolooker.com/account/${newNanoAccount}) for ${tippedUserDisplayName} and sent Ӿ${amount} to it! ⚡️ https://nanolooker.com/block/${blockHash}`,
      replyToTootId
    )
  }

  private tootTipped({
    replyToTootId,
    blockHash,
    tippedUserDisplayName,
    amount,
  }: {
    replyToTootId: string
    tippedUserDisplayName: string
    blockHash: string
    amount: number
  }) {
    this.toot(
      `Tipped ${tippedUserDisplayName} Ӿ${amount}! ⚡️ https://nanolooker.com/block/${blockHash}`,
      replyToTootId
    )
  }

  private tootNoBalance({
    tipperHandle,
    tipperFediverseAccountId,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperFediverseAccountId: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperFediverseAccountId} doesn't have enough balance to tip requested amount`
    )
    this.toot(
      `${tipperHandle}, you don't have enough balance in your account 🥲`,
      replyToTootId
    ) // TODO
  }

  private tootCreatedNewAccountForTipper({
    tipperHandle,
    tipperFediverseAccountId,
    newNanoAccount,
    replyToTootId,
  }: {
    tipperHandle: string
    tipperFediverseAccountId: string
    newNanoAccount: string
    replyToTootId: string
  }) {
    this.logger.warn(
      `Mastodon user ${tipperFediverseAccountId} had not created an account yet. Created account with nano address ${newNanoAccount}`
    )
    this.toot(
      `${tipperHandle}, you hadn't created an account yet 🥺
      Created a new account with address ${newNanoAccount} (https://nanolooker.com/account/${newNanoAccount})
      Please send some nano to it and try again ⚡️`,
      replyToTootId
    )
  }

  private async getNanoAddressAndDisplayNameFromFediverseAccountId(
    fediverseAccountId: string
  ) {
    const tippedUserFediverseAccount = await this.getMastodonAccount(
      fediverseAccountId
    )
    const nanoAddress = tippedUserFediverseAccount.fields.find(({ name }) => {
      const nameLower = name.toLocaleUpperCase()
      return nameLower === 'XNO' || nameLower === 'NANO' || nameLower === 'Ӿ'
    })?.value

    return { nanoAddress, displayName: tippedUserFediverseAccount.display_name }
  }

  private async onToot(toot: Toot) {
    const {
      amount,
      isCustodial,
      shouldSplitAmount,
      userIdsToTip,
      tippedUserFediverseAccountId,
    } = this.parseToot(toot)

    const amountInRaw = convert(amount.toString(), {
      from: Unit.Nano,
      to: Unit.raw,
    })

    if (!isCustodial) return // TODO

    let tipperAccount = await this.accountsService.getAccount(toot.account.id)

    if (!tipperAccount) {
      tipperAccount = await this.accountsService.createAccount(toot.account.id)
      this.tootCreatedNewAccountForTipper({
        tipperHandle: `@${toot.account.acct}`,
        tipperFediverseAccountId: toot.account.id,
        newNanoAccount: tipperAccount.nanoAddress,
        replyToTootId: toot.id,
      })
    }

    const { balance } = await this.nanoService.getNanoAccountInfo(
      tipperAccount.nanoAddress
    )

    if (Big(amountInRaw).gt(balance))
      this.tootNoBalance({
        tipperHandle: `@${toot.account.acct}`,
        replyToTootId: toot.id,
        tipperFediverseAccountId: toot.account.id,
      })

    const shouldIgnoreReply = userIdsToTip.length > 0

    if (shouldIgnoreReply) {
      // TODO
    } else {
      const info =
        await this.getNanoAddressAndDisplayNameFromFediverseAccountId(
          tippedUserFediverseAccountId
        )
      let tippedUserNanoAddress = info.nanoAddress
      const tippedUserDisplayName = info.displayName

      let createdAccountForTippedUser = false

      if (!tippedUserNanoAddress) {
        let tippedUserAccount = await this.accountsService.getAccount(
          tippedUserFediverseAccountId
        )

        if (!tippedUserAccount) {
          createdAccountForTippedUser = true
          tippedUserAccount = await this.accountsService.createAccount(
            tippedUserFediverseAccountId
          )
        }

        tippedUserNanoAddress = tippedUserAccount.nanoAddress
      }

      const { privateKey } = this.nanoService.getAddressAndPkFromIndex(
        tipperAccount.nanoIndex
      )

      const { hash } = await this.nanoService.sendNano({
        amount: amountInRaw,
        from: tipperAccount.nanoAddress,
        to: tippedUserNanoAddress,
        privateKey,
      })

      const tootParams = {
        blockHash: hash,
        amount,
        replyToTootId: toot.id,
        tippedUserDisplayName: tippedUserDisplayName,
      }

      if (createdAccountForTippedUser)
        this.tootCreatedAccountAndTipped({
          ...tootParams,
          newNanoAccount: tippedUserNanoAddress,
        })
      else this.tootTipped(tootParams)
    }
  }

  onModuleInit() {
    this.listenToToots(toot => {
      try {
        this.onToot(toot)
      } catch {} // TODO
    })
  }

  private async toot(status: string, inReplyTo?: string) {
    const tootRes = await this.httpService.axiosRef.post<Toot>('/statuses', {
      status,
      in_reply_to_id: inReplyTo,
    })

    if (tootRes.status >= 300) throw new Error(tootRes.statusText)

    return tootRes.data
  }

  private parseToot(toot: Toot) {
    const content = new JSDOM(toot.content)
    const firstLine = content.window.document.querySelector('p')
    const textContent = firstLine?.textContent

    if (!textContent) throw new Error('Toot is badly formatted')

    const parts = textContent.split(' ')
    const amount = parts.find(part => !isNaN(+part) && +part !== 0)

    if (!amount) throw new Error('Toot is badly formatted')

    const isCustodial = !parts.includes('non-custodial')
    const shouldSplitAmount = !parts.includes('split')
    const tippedUserFediverseAccountId = toot.in_reply_to_account_id
    const userIdsToTip = toot.mentions.map(({ id }) => id)

    return {
      amount: +amount,
      isCustodial,
      userIdsToTip,
      shouldSplitAmount,
      tippedUserFediverseAccountId,
    }
  }

  private async getMastodonAccount(id: string) {
    const accountRes = await this.httpService.axiosRef.get<Account>(
      `/accounts/${id}`
    )

    if (accountRes.status >= 300) throw new Error(accountRes.statusText)

    return accountRes.data
  }

  private listenToToots(onToot: (toot: Toot) => void, tag?: string) {
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
