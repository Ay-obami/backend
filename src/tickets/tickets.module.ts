import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { StellarModule } from '../stellar/stellar.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { OfflineTokenService } from './offline-token.service';
import { ResaleExpiryService } from './resale-expiry.service';
import { ScanRateLimitGuard } from '../common/guards/scan-rate-limit.guard';

@Module({
  imports: [OrganizationsModule, StellarModule],
  controllers: [TicketsController],
  providers: [
    TicketsService,
    OfflineTokenService,
    ResaleExpiryService,
    ScanRateLimitGuard,
  ],
  exports: [TicketsService, ResaleExpiryService],
})
export class TicketsModule {}
