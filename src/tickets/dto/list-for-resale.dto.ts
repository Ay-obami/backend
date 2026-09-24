import { IsBigIntString } from '../../common/decorators/is-bigint-string.decorator';

export class ListForResaleDto {
  /** Asking price in the settlement token's smallest unit, as a string to preserve i128 precision. */
  @IsBigIntString()
  price: string;
}
