import { Module } from '@nestjs/common';
import { InsurancesService } from './insurances.service';
import { InsurancesController } from './insurances.controller';
import { InsuranceHelper } from './insurance.helper';
import { InsuranceContractService } from './insurance-contract.service';
import { InsuranceSchedule } from './insurances.schedule';
import { PriceModule } from 'src/price/price.module';
import { TransactionsModule } from 'src/transactions/transactions.module';
import { InsurancesCommand } from './insurances.command';
import { PairsModule } from '../pairs/pairs.module';
import { NibiruModule } from 'src/nibiru/nibiru.module';
import { BinanceModule } from 'src/binance/binance.module';

@Module({
  imports: [
    PriceModule,
    PairsModule,
    TransactionsModule,
    NibiruModule,
    BinanceModule,
  ],
  controllers: [InsurancesController],
  providers: [
    InsurancesService,
    InsuranceHelper,
    InsuranceContractService,
    InsuranceSchedule,
    InsurancesCommand,
  ],
  exports: [InsurancesService, InsuranceContractService],
})
export class InsurancesModule {}
