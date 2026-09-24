import { IsOptional, IsUUID } from 'class-validator';
import { ConfirmSignedTxDto } from './confirm-signed-tx.dto';

export class ConfirmCheckInDto extends ConfirmSignedTxDto {
  /** Which gate scanned this ticket, if the venue tracks multiple entrances. */
  @IsOptional()
  @IsUUID()
  gateId?: string;
}
