import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validate } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { EventsModule } from './events/events.module';
import { TicketsModule } from './tickets/tickets.module';
import { StellarModule } from './stellar/stellar.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { PromoCodesModule } from './promo-codes/promo-codes.module';
import { GatesModule } from './gates/gates.module';
import { ScannerDevicesModule } from './scanner-devices/scanner-devices.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
    StellarModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    EventsModule,
    TicketsModule,
    NotificationsModule,
    WaitlistModule,
    PromoCodesModule,
    GatesModule,
    ScannerDevicesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
