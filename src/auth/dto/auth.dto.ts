import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsSuiAddress } from 'src/common/validators/is-sui-address';

export class AuthDto {
  @ApiProperty({
    type: String,
    description: 'Nibiru address',
    example: 'nibi1qjlt4u552tv5qdmp0k3rnc3zemf5lw9mznxlsx',
  })
  @IsNotEmpty()
  @IsSuiAddress()
  walletAddress: string;

  @ApiProperty({ type: String })
  @IsNotEmpty()
  @IsString()
  publicKey: string;

  @ApiProperty({ type: String })
  @IsNotEmpty()
  @IsString()
  signature: string;
}
