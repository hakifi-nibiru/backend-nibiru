import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Config, ContractConfig } from 'src/configs/config.interface';
import dayjs from 'dayjs';
import { PrismaService } from 'nestjs-prisma';
import {
  Insurance,
  InsuranceState,
  StateLog,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { InsuranceHelper } from './insurance.helper';
import {
  INVALID_REASONS,
  IsuranceContractType,
} from './constant/insurance.contant';
import { PriceService } from 'src/price/price.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { INSURANCE_EVENTS } from 'src/common/constants/event';
import { TransactionsService } from 'src/transactions/transactions.service';

import { floor } from 'src/common/helpers/utils';
import { isMongoId } from 'class-validator';
import { BinanceService } from 'src/binance/binance.service';

import {
  NibiruTxClient,
  newSignerFromMnemonic,
  Chain,
  NibiruQuerier,
  Testnet,
} from "@nibiruchain/nibijs"
import ReconnectingWebSocket from 'reconnecting-websocket';
import WebSocket from 'ws';

@Injectable()
export class InsuranceContractService implements OnModuleInit {
  logger = new Logger(InsuranceContractService.name);

  private decimals = 10**6;
  private contractAddress: string;

  private readonly chain: Chain;
  private querier: NibiruQuerier;
  private txClient: NibiruTxClient;
  private mnemonic: string;
  private moderator: string;
  private fee: any;
  private readonly wsEndpoint: string;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService<Config>,
    private readonly priceService: PriceService,
    private readonly insuranceHelper: InsuranceHelper,
    private readonly eventEmitter: EventEmitter2,
    private readonly transactionService: TransactionsService,
    private readonly binanceService: BinanceService,
  ) {
    const config = this.configService.get<ContractConfig>('contract');
    this.contractAddress = config.contractAddress;
    this.chain = Testnet(1);
    this.mnemonic = config.mnemonic;
    this.wsEndpoint = 'wss://rpc.testnet-1.nibiru.fi/websocket';
    this.fee = {
      amount: [{
        denom: 'unibi', 
        amount: '50000', 
      }],
      gas: "2000000",
    };
  }

  async onModuleInit() { 
    const ws = new ReconnectingWebSocket(this.wsEndpoint, [], {
      WebSocket: WebSocket,
      maxRetries: Infinity,
      connectionTimeout: 1000, 
    });

    ws.addEventListener('open', () => {
      this.logger.log('Connected to WebSocket');
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        id: "1",
        params: {
          query: `tm.event = 'Tx' AND execute._contract_address = '${this.contractAddress}'`
        }
      }));
    });

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data.toString());      
      if (data.result && data.result.events) {
        const events = data.result.events;        
        if (events['wasm-EInsurance._contract_address'] && events['wasm-EInsurance._contract_address'].includes(this.contractAddress)) {
          const insuranceEvent = {
            tx_hash: events['tx.hash'] ? events['tx.hash'][0] : null,
            id_insurance: events['wasm-EInsurance.id_insurance'] ? events['wasm-EInsurance.id_insurance'][0] : null,
            buyer: events['wasm-EInsurance.buyer'] ? events['wasm-EInsurance.buyer'][0] : null,
            margin: events['wasm-EInsurance.margin'] ? events['wasm-EInsurance.margin'][0] : null,
            claim_amount: events['wasm-EInsurance.claim_amount'] ? events['wasm-EInsurance.claim_amount'][0] : null,
            expired_time: events['wasm-EInsurance.expired_time'] ? events['wasm-EInsurance.expired_time'][0] : null,
            open_time: events['wasm-EInsurance.open_time'] ? events['wasm-EInsurance.open_time'][0] : null,
            state: events['wasm-EInsurance.state'] ? events['wasm-EInsurance.state'][0] : null,
            event_type: events['wasm-EInsurance.event_type'] ? events['wasm-EInsurance.event_type'][0] : null
          };
          this.onEventInsurance(insuranceEvent); 
        }
      } 
    });

    ws.addEventListener('error', (error) => {
      this.logger.error('WebSocket Error:', error);
    });

    ws.addEventListener('close', () => {
      this.logger.log('WebSocket connection closed');
    });
  }

  async connect() {
    const signer = await newSignerFromMnemonic(this.mnemonic!);
    const [{ address: fromAddr }] = await signer.getAccounts();
    this.txClient = await NibiruTxClient.connectWithSigner(
      this.chain.endptTm,
      signer,
    )
    this.querier = await NibiruQuerier.connect(this.chain.endptTm)
    this.moderator = fromAddr;
  }

  onEventInsurance(event) {
    //todo: get event when update txhash   
    const id = event.id_insurance as string;
    const address = event.buyer as string;
    const margin = Number(event.margin) / this.decimals;
    const eventType = event.event_type as string;
    const txhash = event.tx_hash;
    const unit = 'USDT';
    this.logger.debug('onEventInsurance:', {
      eventType,
      id,
      address,
      margin,
      txhash,
    });

    if (!isMongoId(id)) {
      return;
    }
    
    switch (eventType) {
      case IsuranceContractType.CREATE: // CREATE
        this.logger.debug('onContractCreated');
        this.onContractCreated(id, address, unit, margin, txhash);
        break;
      case IsuranceContractType.UPDATE_AVAILABLE: // UPDATE_AVAILABLE
        break;
      case IsuranceContractType.UPDATE_INVALID: // UPDATE_INVALID
        break;
      case IsuranceContractType.REFUND: // REFUND
        // this.logger.debug('onContractStateChanged', {
        //   id,
        //   state: InsuranceState.REFUNDED,
        //   txhash,
        // });
        // this.onContractStateChanged(id, InsuranceState.REFUNDED, txhash);
        break;
      case IsuranceContractType.CANCEL: // CANCEL
        break;
      case IsuranceContractType.CLAIM: // CLAIM
        // this.logger.debug('onContractStateChanged', {
        //   id,
        //   state: InsuranceState.CLAIMED,
        //   txhash,
        // });
        // this.onContractStateChanged(id, InsuranceState.CLAIMED, txhash);
        break;
      case IsuranceContractType.EXPIRED: // EXPIRED
        break;
      case IsuranceContractType.LIQUIDATED: // LIQUIDATED
        break;
      default:
        break;
    }
  }


  /**
   * Handles the event when a contract is created.
   * @param id - The ID of the contract.
   * @param address - The address of the contract.
   * @param unit - The unit of the contract.
   * @param margin - The margin of the contract.
   * @param txhash - The transaction hash of the contract.
   */
  private async onContractCreated(
    id: string,
    address: string,
    unit: string,
    margin: number,
    txhash: string,
  ) {
    const insurance = await this.prismaService.insurance.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
    });

    if (!insurance) {
      return;
    }

    this.updateTxhash(id, txhash);    
    const isLocked = await this.insuranceHelper.isInsuranceLocked(id);
    
    if (isLocked) {
      this.logger.warn(`Insurance ${id} is locked`);
      return;
    }

    if (insurance.state !== InsuranceState.PENDING) {
      this.logger.warn(`Insurance ${id} is not pending`);
      return;
    }    
    let invalidReason;
    let payback = false;
    if (margin !== insurance.margin) {
      invalidReason = INVALID_REASONS.INVALID_MARGIN;
    } else if (insurance.user?.walletAddress !== address) {
      invalidReason = INVALID_REASONS.INVALID_WALLET_ADDRESS;
    } else if (dayjs().diff(insurance.createdAt, 'seconds') > 60) {
      invalidReason = INVALID_REASONS.CREATED_TIME_TIMEOUT;
      payback = true;
    } else if (insurance.unit !== unit) {
      invalidReason = INVALID_REASONS.INVALID_UNIT;
    }

    if (!!invalidReason) {
      this.invalidateInsurance(id, invalidReason, payback, address);
      return;
    }
    try {
      insurance.txhash = txhash;
      await this.availableInsurance(insurance);
    } catch (error) {
      this.logger.error('Error when availableInsurance: ' + error.message);
    }
  }

  async onContractStateChanged(
    id: string,
    state: InsuranceState,
    txhash?: string,
  ) {
    try {
      const updated = await this.prismaService.insurance.update({
        where: { id, state: { not: state } },
        data: {
          state,
          closedAt: new Date(),
        },
      });

      if (updated) {
        this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updated);
        this.addStateLog(id, {
          state,
          time: new Date(),
          txhash,
          error: null,
        });
      }
    } catch (error) {
      this.logger.error('Error when onContractStateChanged: ' + error.message);
    }
  }

  async invalidateInsurance(
    id: string,
    invalidReason: string = '',
    payback = true,
    creatorAdress: string,
  ) {

    await this.connect();    
    this.logger.log(`Invalidate Insurance ${id}`);
    await this.insuranceHelper.lockInsurance(id, async () => {
      await this.prismaService.insurance.update({
        where: { id },
        data: {
          state: InsuranceState.INVALID,
          invalidReason,
          closedAt: new Date(),
        },
      });

      let hash: string;
      let error: string;
      if (payback) {
        try {
          const msg = {
            update_invalid_insurance: {
              id_insurance: id
            },
          };
          const result = await this.txClient.wasmClient.execute(this.moderator, this.contractAddress, msg, this.fee, undefined, []);
          hash = result.transactionHash;          
        } catch (e) {
          this.logger.error('Error when updateInvalidInsurance: ' + e.message);
          error = e.message;
        }
      }

      this.addStateLog(id, {
        state: InsuranceState.INVALID,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
  }

  async availableInsurance(insurance: Insurance) {
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      const symbol = `${insurance.asset}${insurance.unit}`;
      const currentPrice = await this.priceService.getFuturePrice(symbol);

      const {
        expiredAt,
        hedge,
        p_liquidation,
        q_claim,
        systemCapital,
        p_refund,
        leverage,
        p_cancel,
      } = this.insuranceHelper.calculateInsuranceParams({
        margin: insurance.margin,
        q_covered: insurance.q_covered,
        p_open: currentPrice,
        p_claim: insurance.p_claim,
        period: insurance.period,
        periodUnit: insurance.periodUnit,
        periodChangeRatio: insurance.periodChangeRatio,
      });
      let updatedInsurance: Insurance;

      const futureQuantity = this.insuranceHelper.calculatFutureQuantity({
        hedge,
        margin: insurance.margin,
        p_claim: insurance.p_claim,
        p_open: currentPrice,
        periodChangeRatio: insurance.periodChangeRatio,
      });
      try {
        updatedInsurance = await this.prismaService.insurance.update({
          where: { id: insurance.id, state: { not: InsuranceState.AVAILABLE } },
          data: {
            state: InsuranceState.AVAILABLE,
            p_open: currentPrice,
            p_liquidation,
            q_claim,
            systemCapital,
            p_refund,
            p_cancel,
            leverage,
            expiredAt,
            hedge,
            futureQuantity,
          },
        });
      } catch (error) {
        return;
      }

      if (!updatedInsurance) return;

      this.transactionService.create({
        amount: insurance.margin,
        insuranceId: insurance.id,
        status: TransactionStatus.SUCCESS,
        txhash: insurance.txhash,
        type: TransactionType.MARGIN,
        unit: insurance.unit,
        userId: insurance.userId,
      });
      
      this.eventEmitter.emit(INSURANCE_EVENTS.CREATED, updatedInsurance);
      await this.availableContractInsurance(updatedInsurance);

      //TODO: Transfer To Binance
      if (updatedInsurance.canTransferBinance) {
        this.binanceService.order(updatedInsurance);
      }
      //End TODO

    });
  }

  async availableContractInsurance(insurance: Insurance) {
    let hash: string;
    let error: string;
    try {
      await this.connect();
      const user = await this.prismaService.user.findUnique({
        where: { id: insurance.userId },
        select: {
          walletAddress: true,
        },
      });
      if (!user) throw new Error('User not found');

      const q_claim = floor(insurance.q_claim * this.decimals, 0);
      const msg = {
        update_available_insurance: {
          id_insurance: insurance.id,
          claim_amount: q_claim.toString(),
          expired_time: Number(dayjs(insurance.expiredAt).unix()),
        },
      };

      const result = await this.txClient.wasmClient.execute(this.moderator, this.contractAddress, msg, this.fee, undefined, []);
      hash = result.transactionHash;      
    } catch (e) {
      this.logger.error(
        'Smart Contract updateAvailableInsurance Error: ' + e.message,
      );
      error = e.message;
    }

    this.addStateLog(insurance.id, {
      state: InsuranceState.AVAILABLE,
      txhash: hash,
      error,
      time: new Date(),
    });
  }

  async cancelInsurance(insurance: Insurance, p_close: number) {
    await this.connect();    
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      updatedInsurance = await this.prismaService.insurance.update({
        where: { id: insurance.id, state: { not: InsuranceState.CANCELLED } },
        data: {
          state: InsuranceState.CANCELLED,
          p_close,
          closedAt: new Date(),
          pnlProject: insurance.pnlBinance - insurance.pnlUser,
        },
      });
      if (!updatedInsurance) return;
      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      let hash: string;
      let error: string;
      try {
        const user = await this.prismaService.user.findUnique({
          where: { id: insurance.userId },
          select: {
            walletAddress: true,
          },
        });
        if (!user) throw new Error('User not found');
        const msg = {
          cancel_insurance: {
            id_insurance: insurance.id
          },
        };
        const result = await this.txClient.wasmClient.execute(this.moderator, this.contractAddress, msg, this.fee, undefined, []);
        hash = result.transactionHash;
      } catch (e) {
        this.logger.error('Error when cancelInsurance: ' + e.message);
        error = e.message;
      }

      if (hash) {
        this.transactionService.create({
          amount: insurance.margin,
          insuranceId: insurance.id,
          status: TransactionStatus.SUCCESS,
          txhash: hash,
          type: TransactionType.CANCEL,
          unit: insurance.unit,
          userId: insurance.userId,
        });
      }

      this.addStateLog(insurance.id, {
        state: InsuranceState.CANCELLED,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
    return updatedInsurance;
  }

  public async claimInsurance(insurance: Insurance, currentPrice: number) {
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      const pnlUser = insurance.q_claim - insurance.margin;
      updatedInsurance = await this.prismaService.insurance.update({
        where: {
          id: insurance.id,
          state: { not: InsuranceState.CLAIM_WAITING },
        },
        data: {
          state: InsuranceState.CLAIM_WAITING,
          p_close: currentPrice,
          pnlUser,
          pnlProject: insurance.pnlBinance - pnlUser,
          closedAt: new Date(),
        },
      });
      if (!updatedInsurance) return;
      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      await this.claimContractInsurance(insurance);
    });
    return updatedInsurance;
  }

  public async claimContractInsurance(insurance: Insurance) {
    let hash: string;
    let error: string;
    try {
    await this.connect();    
      const user = await this.prismaService.user.findUnique({
        where: { id: insurance.userId },
        select: {
          walletAddress: true,
        },
      });
      if (!user) throw new Error('User not found');
      const msg = {
        claim_insurance: {
          id_insurance: insurance.id
        },
      };
      const result = await this.txClient.wasmClient.execute(this.moderator, this.contractAddress, msg, this.fee, undefined, []);
      hash = result.transactionHash;
    } catch (e) {
      this.logger.error('Smart Contract claimInsurance Error: ' + e.message);
      error = e.message;
    }

    await this.addStateLog(insurance.id, {
      state: InsuranceState.CLAIM_WAITING,
      txhash: hash,
      error,
      time: new Date(),
    });

    if (hash) {
      this.transactionService.create({
        amount: insurance.q_claim,
        insuranceId: insurance.id,
        status: TransactionStatus.SUCCESS,
        txhash: hash,
        type: TransactionType.CLAIM,
        unit: insurance.unit,
        userId: insurance.userId,
      });

      await this.onContractStateChanged(
        insurance.id,
        InsuranceState.CLAIMED,
        hash,
      );
    }
  }

  public async refundInsurance(insurance: Insurance, p_close: number) {
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      updatedInsurance = await this.prismaService.insurance.update({
        where: {
          id: insurance.id,
          state: { not: InsuranceState.REFUND_WAITING },
        },
        data: {
          state: InsuranceState.REFUND_WAITING,
          p_close,
          closedAt: new Date(),
          pnlProject: insurance.pnlBinance - insurance.pnlUser,
        },
      });
      if (!updatedInsurance) return;
      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      await this.refundContractInsurance(insurance);
    });
    return updatedInsurance;
  }

  public async refundContractInsurance(insurance: Insurance) {
    await this.connect();    
    let hash: string;
    let error: string;
    try {
      const user = await this.prismaService.user.findUnique({
        where: { id: insurance.userId },
        select: {
          walletAddress: true,
        },
      });
      if (!user) throw new Error('User not found');
      const msg = {
        refund_insurance: {
          id_insurance: insurance.id
        },
      };
      const result = await this.txClient.wasmClient.execute(this.moderator, this.contractAddress, msg, this.fee, undefined, []);
      hash = result.transactionHash;
    } catch (e) {
      this.logger.error('Smart Contract refundInsurance Error: ' + e.message);
      error = e.message;
    }

    await this.addStateLog(insurance.id, {
      state: InsuranceState.REFUND_WAITING,
      txhash: hash,
      error,
      time: new Date(),
    });

    if (hash) {
      this.transactionService.create({
        amount: insurance.margin,
        insuranceId: insurance.id,
        status: TransactionStatus.SUCCESS,
        txhash: hash,
        type: TransactionType.REFUND,
        unit: insurance.unit,
        userId: insurance.userId,
      });

      await this.onContractStateChanged(
        insurance.id,
        InsuranceState.REFUNDED,
        hash,
      );
    }
  }

  public async liquidatedOrExpiredInsurance(
    insurance: Insurance,
    state: InsuranceState,
    p_close: number,
  ) {
    await this.connect();    
    let updatedInsurance: Insurance;
    await this.insuranceHelper.lockInsurance(insurance.id, async () => {
      const pnlUser = -insurance.margin;
      updatedInsurance = await this.prismaService.insurance.update({
        where: { id: insurance.id, state: { not: state } },
        data: {
          state,
          p_close,
          closedAt: new Date(),
          pnlUser,
          pnlProject: insurance.pnlBinance - pnlUser,
        },
      });

      if (!updatedInsurance) return;

      this.eventEmitter.emit(INSURANCE_EVENTS.UPDATED, updatedInsurance);

      let hash: string;
      let error: string;
      try {
        const user = await this.prismaService.user.findUnique({
          where: { id: insurance.userId },
          select: {
            walletAddress: true,
          },
        });
        if (!user) throw new Error('User not found');

        switch (state) {
          case InsuranceState.LIQUIDATED:
            const liquidateResult = await this.txClient.wasmClient.execute(
              this.moderator,
              this.contractAddress,
              {
                liquidate_insurance: {
                  id_insurance: insurance.id
                },
              },
              this.fee,
              undefined,
              []
            );
            hash = liquidateResult.transactionHash;
            break;
          case InsuranceState.EXPIRED:
            const expireResult = await this.txClient.wasmClient.execute(
              this.moderator,
              this.contractAddress,
              {
                expire_insurance: {
                  id_insurance: insurance.id
                },
              },
              this.fee,
              undefined,
              []
            );
            hash = expireResult.transactionHash;
            break;
        }
      } catch (e) {
        this.logger.error(
          'Smart Contract liquidatedOrExpiredInsurance Error: ' + e.message,
        );
        error = e.message;
      }

      this.addStateLog(insurance.id, {
        state,
        txhash: hash,
        error,
        time: new Date(),
      });
    });
    return updatedInsurance;
  }

  private async updateTxhash(id: string, txhash: string) {
    try {
      await this.prismaService.insurance.update({
        where: { id },
        data: {
          txhash,
        },
      });
    } catch (error) {
      this.logger.error('Error when update txhash: ' + error.message);
    }
  }

  private async addStateLog(id: string, stateLog: StateLog) {
    try {
      const ins = await this.prismaService.insurance.update({
        where: { id },
        data: {
          stateLogs: {
            push: stateLog,
          },
        },
      });
      return ins;
    } catch (error) {
      this.logger.error('addStateLog Error: ', error);
    }
  }

  async getInsuranceContract(id: string) {
    await this.connect();
    try {
      const queryMsg = {
        get_insurance_info: {
          id_insurance: id,
        },
      };
      const data = await this.querier.wasmClient.queryContractSmart(this.contractAddress, queryMsg);        
      return {
        id,
        address: data.buyer as string,
        margin: Number(data.margin) / this.decimals,
        unit: 'USDT',
        q_claim: Number(data.claim_amount) / this.decimals,
        state: data.state,
        valid: data.valid,
      };
    } catch (error) {
      return null;
    }
  }
}
