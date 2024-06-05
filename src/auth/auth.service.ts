import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthDto } from './dto/auth.dto';
import { UsersService } from 'src/users/users.service';
import { ConfigService } from '@nestjs/config';
import { Config } from 'src/configs/config.interface';
import { verifyADR36Amino } from '@keplr-wallet/cosmos';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService<Config>,
  ) {}

  public async loginWithCredentials(loginDTO: AuthDto) {
    const { walletAddress, publicKey, signature } = loginDTO;

    let user = await this.usersService.findByWalletAddress(walletAddress);

    if (!user) {
      throw new UnauthorizedException('User not found!');
    }

    if (!user.nonce) {
      throw new UnauthorizedException('Nonce not found!');
    }
    
    try {
      const isValid = this.verifySignature(
        walletAddress,
        publicKey,
        user.nonce,
        signature,
      );
      if (!isValid) {
        throw new Error();
      }
    } catch (error) {
      throw new UnauthorizedException('Signature is invalid');
    }

    user = await this.usersService.updateUserOnLogin(walletAddress);

    const payload = { id: user.id, walletAddress };

    return {
      accessToken: this.generateToken(payload),
      user,
    };
  }

  public prepareSigningMessage(nonce: number) {
    return `Please sign this message to verify your address. Nonce: ${nonce}`;
  }

  public async verifySignature(
    walletAddress: string,
    publicKey: string,
    nonce: number,
    signature: string,
  ) {
    
    const message = this.prepareSigningMessage(nonce);  

    const prefix = "nibi"; 

    const signatureBuffer = Buffer.from(signature, 'base64');

    const uint8Signature = new Uint8Array(signatureBuffer); 

    const pubKeyValueBuffer = Buffer.from(publicKey, 'base64');

    const pubKeyUint8Array = new Uint8Array(pubKeyValueBuffer);     

    const isRecovered = verifyADR36Amino(prefix, walletAddress, message, pubKeyUint8Array, uint8Signature, "secp256k1");
    
    return isRecovered;
  }

  public generateToken(payload: any) {
    return this.jwtService.sign(payload, {
      secret: this.configService.get('jwtSecretKey'),
    });
  }

  public verifyToken(token: string) {
    return this.jwtService.verify(token, {
      secret: this.configService.get('jwtSecretKey'),
    });
  }

}

