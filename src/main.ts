import { NestFactory } from '@nestjs/core'
import Big from 'big.js'

import { AppModule } from './app.module'

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule)
  Big.PE = 50
  await app.listen(process.env.PORT || 5000)
}
bootstrap()
