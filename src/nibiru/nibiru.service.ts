import { Injectable } from '@nestjs/common';
import { floor } from 'src/common/helpers/utils';
import { ConfigService } from '@nestjs/config';
import { Config, ContractConfig } from 'src/configs/config.interface';
import {
  NibiruTxClient,
  newSignerFromMnemonic,
  Chain,
  NibiruQuerier,
  Testnet,
} from "@nibiruchain/nibijs"

@Injectable()
export class NibiruService {
  tokenDecimalsMap = new Map<string, number>();
  private cw20Address: string;
  private readonly chain: Chain;
  private querier: NibiruQuerier;
  private txClient: NibiruTxClient;
  private mnemonic: string;
  private moderator: string;

  constructor(
    private readonly configService: ConfigService<Config>,
  ) {
    const config = this.configService.get<ContractConfig>('contract');
    this.cw20Address = config.cw20Address;
    this.chain = Testnet(1);
    this.mnemonic = config.mnemonic;   
  }

  async connect(): Promise<void> {
    this.querier = await NibiruQuerier.connect(this.chain.endptTm);
    const signer = await newSignerFromMnemonic(this.mnemonic);
    this.txClient = await NibiruTxClient.connectWithSigner(
      this.chain.endptTm,
      signer
    );
    const [{ address: fromAddr }] = await signer.getAccounts();
    this.moderator = fromAddr;
  }

  public async getConnection() {
    await this.connect();
    return this.txClient;
  }

  public async transferSplToken(
    receiverAddress: string,
    amount: number,
  ) {
    // Transfer token
    await this.connect();
    const decimals = await this.getTokenDecimals(this.cw20Address);
    const toAmount = floor(amount, decimals) * Math.pow(10, decimals);    
    const gasLimit = 2000000;
    const fee = {
      amount: [{
        denom: 'unibi', 
        amount: '50000', 
      }],
      gas: gasLimit.toString(),
    }; 
    
    const transferMsg = {
      transfer: {
          recipient: receiverAddress,
          amount: toAmount.toString(),
          },
      };    
    const result2 = await this.txClient.wasmClient.execute(this.moderator, this.cw20Address, transferMsg, fee);
    return result2.transactionHash;
  }

  // Get token decimals
  async getTokenDecimals(tokenAddress: string) {
    await this.connect();
    const queryMsgs = { token_info: {} };
    const response = await this.querier.wasmClient.queryContractSmart(tokenAddress, queryMsgs);
    return response.decimals;
  }

  async getSplTokenBalance(
    walletPubkey: string,
  ) {
    await this.connect();
    const queryCw20 = { balance: { address: walletPubkey } };
    const response = await this.querier.wasmClient.queryContractSmart(this.cw20Address, queryCw20);
    if (response.balance == null) return 0;
    return Number(response.balance);
  }

  
}
