import { IsBigIntString } from '../../common/decorators/is-bigint-string.decorator';
import { ConfirmSignedTxDto } from './confirm-signed-tx.dto';

export class ConfirmListForResaleDto extends ConfirmSignedTxDto {
  @IsBigIntString()
  price: string;
}
