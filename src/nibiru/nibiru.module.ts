import { Module } from '@nestjs/common';
import { NibiruService } from './nibiru.service';

@Module({
  providers: [NibiruService],
  exports: [NibiruService],
})
export class NibiruModule {}
