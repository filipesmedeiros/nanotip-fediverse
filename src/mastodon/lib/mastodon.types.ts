export interface Toot {
  id: string
  created_at: string
  in_reply_to_id: string | null
  in_reply_to_account_id: string | null
  sensitive: boolean
  spoiler_text: string
  visibility: 'public'
  language: string
  uri: string
  url: string
  replies_count: number
  reblogs_count: number
  favourites_count: number
  edited_at: null
  content: string
  reblog: null
  application: {
    name: string
    website: string | null
  }
  account: {
    id: string
    username: string
    acct: string
    display_name: string
    locked: boolean
    bot: boolean
    discoverable: boolean
    group: boolean
    created_at: string
    note: string
    url: string
    avatar: string
    avatar_static: string
    header: string
    header_static: string
    followers_count: number
    following_count: number
    statuses_count: number
    last_status_at: string
    emojis: []
    fields: {
      name: string
      value: string
      verified_at: null
    }[]
  }
  media_attachments: []
  mentions: {
    id: string
    username: string
    url: string
    acct: string
  }[]
  tags: {
    name: string
    url: string
  }[]
  emojis: []
  card: null
  poll: null
}

export interface Account {
  id: string
  username: string
  acct: string
  display_name: string
  locked: false
  bot: false
  created_at: string
  note: string
  url: string
  avatar: string
  avatar_static: string
  header: string
  header_static: string
  followers_count: number
  following_count: number
  statuses_count: number
  last_status_at: string
  emojis: []
  fields: {
    name: string
    value: string
    verified_at: string
  }[]
}
