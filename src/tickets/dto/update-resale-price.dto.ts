import { IsString } from 'class-validator';

export class UpdateResalePriceDto {
  /** Updated asking price in settlement token smallest units. */
  @IsString()
  price: string;
}
