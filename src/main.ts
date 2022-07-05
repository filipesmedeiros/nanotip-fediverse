import { NestFactory } from '@nestjs/core'
import Big from 'big.js'

import { AppModule } from './app.module'

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule)
  Big.PE = 50
  await app.listen(6969) // I actually don't need to listen, but Render is free only for services that bind to a port LOL
}
bootstrap()
