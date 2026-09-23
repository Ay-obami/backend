import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// TicketsService only needs StellarService's shape here (it's fully mocked
// below); avoid touching the real @stellar/stellar-sdk import chain, which
// ships ESM-only transitive deps (@noble/hashes, uint8array-extras) that
// Jest can't parse without a much heavier transform config.
jest.mock('../stellar/stellar.service', () => ({ StellarService: jest.fn() }));

import { TicketsService } from './tickets.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrganizationsService } from '../organizations/organizations.service';
import type { StellarService } from '../stellar/stellar.service';
import type { OfflineTokenService } from './offline-token.service';
import type { ConfigService } from '@nestjs/config';

function buildTicketType(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tt-1',
    name: 'GA',
    price: 1_000n,
    quantityIssued: 0,
    quantityTotal: 100,
    event: {
      id: 'event-1',
      organizationId: 'org-1',
      chainEventId: 42n,
      organization: { stellarAccount: 'GORGANIZER' },
    },
    ...overrides,
  };
}

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: {
    ticketType: { findUnique: jest.Mock; update: jest.Mock };
    ticket: {
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    resaleListing: {
      create: jest.Mock;
      updateMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    resalePriceHistory: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let organizations: { assertMember: jest.Mock };
  let stellar: Record<string, jest.Mock>;
  let offlineTokens: { sign: jest.Mock; getPublicKeys: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    prisma = {
      ticketType: { findUnique: jest.fn(), update: jest.fn() },
      ticket: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      resaleListing: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      resalePriceHistory: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        Array.isArray(cb) ? Promise.all(cb) : cb(prisma),
      ),
    };
    organizations = { assertMember: jest.fn().mockResolvedValue(undefined) };
    stellar = {
      buildIssueTicketTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildPurchasePrimaryTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildTransferTicketTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildCheckInTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildRevokeTicketTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildListForResaleTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildCancelResaleTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      buildBuyResaleTx: jest.fn().mockResolvedValue('unsigned-xdr'),
      submitSignedTransaction: jest
        .fn()
        .mockResolvedValue({ result: 7n, txHash: '0xabc' }),
      verifyTicket: jest.fn(),
    };
    offlineTokens = {
      sign: jest.fn().mockReturnValue({
        payload: {
          ticketId: 'ticket-1',
          chainTicketId: '7',
          eventId: 'event-1',
          status: 'VALID',
          exp: 9_999_999_999,
        },
        kid: 'test-key',
        signature: 'sig',
      }),
      getPublicKeys: jest.fn().mockReturnValue({ 'test-key': 'pem' }),
    };
    config = { get: jest.fn().mockReturnValue(5) };

    service = new TicketsService(
      prisma as unknown as PrismaService,
      organizations as unknown as OrganizationsService,
      stellar as unknown as StellarService,
      undefined,
      offlineTokens as unknown as OfflineTokenService,
      config as unknown as ConfigService,
    );
  });

  describe('buildIssueTx', () => {
    it('rejects once a ticket type is sold out', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(
        buildTicketType({ quantityIssued: 100, quantityTotal: 100 }),
      );

      await expect(
        service.buildIssueTx('organizer-1', 'tt-1', 'buyer-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(stellar.buildIssueTicketTx).not.toHaveBeenCalled();
    });

    it('rejects issuing against an unpublished event', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(
        buildTicketType({
          event: { ...buildTicketType().event, chainEventId: null },
        }),
      );

      await expect(
        service.buildIssueTx('organizer-1', 'tt-1', 'buyer-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires the recipient to have a connected wallet', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.user.findUnique.mockResolvedValue({
        id: 'buyer-1',
        stellarPublicKey: null,
      });

      await expect(
        service.buildIssueTx('organizer-1', 'tt-1', 'buyer-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('builds an issue_ticket transaction against the organizer account', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.user.findUnique.mockResolvedValue({
        id: 'buyer-1',
        stellarPublicKey: 'GBUYER',
      });

      const { unsignedXdr } = await service.buildIssueTx(
        'organizer-1',
        'tt-1',
        'buyer-1',
        'A1',
      );

      expect(unsignedXdr).toBe('unsigned-xdr');
      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'organizer-1',
      );
      expect(stellar.buildIssueTicketTx).toHaveBeenCalledWith({
        organizerPublicKey: 'GORGANIZER',
        chainEventId: 42n,
        toPublicKey: 'GBUYER',
        tier: 'GA',
        seat: 'A1',
        price: 1_000n,
      });
    });
  });

  describe('confirmIssue', () => {
    it('creates the ticket row and increments quantityIssued using the on-chain ticket id', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(buildTicketType());
      prisma.ticket.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'ticket-1', ...data }),
      );

      const ticket = await service.confirmIssue(
        'organizer-1',
        'tt-1',
        'buyer-1',
        'A1',
        'signed-xdr',
      );

      expect(stellar.submitSignedTransaction).toHaveBeenCalledWith(
        'signed-xdr',
      );
      expect(prisma.ticketType.update).toHaveBeenCalledWith({
        where: { id: 'tt-1' },
        data: { quantityIssued: { increment: 1 } },
      });
      expect(ticket).toMatchObject({
        chainTicketId: 7n,
        ownerId: 'buyer-1',
        seat: 'A1',
      });
    });
  });

  describe('transfer', () => {
    it('refuses to build a transfer for a ticket the caller does not own', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'someone-else',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
        },
      });

      await expect(
        service.buildTransferTx('not-the-owner', 'ticket-1', 'friend-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('builds a transfer using both parties on-chain public keys', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'owner-1',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
        },
      });
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'owner-1', stellarPublicKey: 'GOWNER' })
        .mockResolvedValueOnce({ id: 'friend-1', stellarPublicKey: 'GFRIEND' });

      await service.buildTransferTx('owner-1', 'ticket-1', 'friend-1');

      expect(stellar.buildTransferTicketTx).toHaveBeenCalledWith({
        fromPublicKey: 'GOWNER',
        chainTicketId: 7n,
        toPublicKey: 'GFRIEND',
      });
    });
  });

  describe('verify', () => {
    it('reconciles the cached status when it diverges from the chain', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        chainTicketId: 7n,
        status: 'VALID',
        seat: 'A1',
        event: { organizationId: 'org-1', name: 'Radiohead Live' },
        owner: { name: 'Ada Lovelace' },
        ticketType: { name: 'GA' },
      });
      stellar.verifyTicket.mockResolvedValue({
        owner: 'GBUYER',
        status: 'Used',
      });

      const result = await service.verify('staff-1', 'qr-secret-abc');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'USED' },
      });
      expect(result.status).toBe('USED');
      expect(result.eventName).toBe('Radiohead Live');
    });

    it('throws when no ticket matches the scanned secret', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.verify('staff-1', 'unknown-secret'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOfflineToken', () => {
    it('signs a payload built from the ticket for an authorized staff member', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        eventId: 'event-1',
        chainTicketId: 7n,
        status: 'VALID',
        event: { organizationId: 'org-1', organization: {} },
      });

      const token = await service.getOfflineToken('staff-1', 'ticket-1');

      expect(organizations.assertMember).toHaveBeenCalledWith(
        'org-1',
        'staff-1',
      );
      expect(offlineTokens.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 'ticket-1',
          chainTicketId: '7',
          eventId: 'event-1',
          status: 'VALID',
        }),
      );
      expect(token.kid).toBe('test-key');
    });

    it('throws when the ticket does not exist', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(
        service.getOfflineToken('staff-1', 'missing-ticket'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(offlineTokens.sign).not.toHaveBeenCalled();
    });

    it('rejects a caller who is not a member of the owning organization', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        eventId: 'event-1',
        chainTicketId: 7n,
        status: 'VALID',
        event: { organizationId: 'org-1', organization: {} },
      });
      organizations.assertMember.mockRejectedValueOnce(
        new ForbiddenException('You are not a member of this organization'),
      );

      await expect(
        service.getOfflineToken('outsider-1', 'ticket-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(offlineTokens.sign).not.toHaveBeenCalled();
    });
  });

  describe('getOfflinePublicKeys', () => {
    it('returns the offline token service public keys', () => {
      expect(service.getOfflinePublicKeys()).toEqual({ 'test-key': 'pem' });
    });
  });

  describe('resale marketplace', () => {
    it('rejects buying a ticket that is not listed for resale', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        status: 'VALID',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
        },
      });

      await expect(
        service.buildBuyResaleTx('buyer-1', 'ticket-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates an active resale listing on confirm', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'owner-1',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
        },
      });
      prisma.resaleListing.create.mockResolvedValue({
        id: 'listing-1',
        status: 'ACTIVE',
      });

      await service.confirmListForResale(
        'owner-1',
        'ticket-1',
        '1200',
        'signed-xdr',
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'RESALE' },
      });
      expect(prisma.resaleListing.create).toHaveBeenCalledWith({
        data: {
          ticketId: 'ticket-1',
          sellerId: 'owner-1',
          price: 1200n,
          txHash: '0xabc',
          expiresAt: null,
          priceHistory: {
            create: {
              price: 1200n,
            },
          },
        },
      });
    });

    it('enforces soft limit on active resale listings per user (409 Conflict)', async () => {
      prisma.resaleListing.count.mockResolvedValue(5);

      await expect(
        service.buildListForResaleTx('seller-1', 'ticket-1', '1000'),
      ).rejects.toBeInstanceOf(ConflictException);

      await expect(
        service.confirmListForResale(
          'seller-1',
          'ticket-1',
          '1000',
          'signed-xdr',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('supports optional expiresAt when creating resale listing', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        ownerId: 'owner-1',
        chainTicketId: 7n,
        event: {
          organizationId: 'org-1',
          organization: { stellarAccount: 'GORG' },
        },
      });
      prisma.resaleListing.create.mockResolvedValue({
        id: 'listing-1',
        status: 'ACTIVE',
      });

      const expiryStr = '2026-12-31T23:59:59.000Z';
      await service.confirmListForResale(
        'owner-1',
        'ticket-1',
        '1200',
        'signed-xdr',
        expiryStr,
      );

      const expectedData: unknown = expect.objectContaining({
        expiresAt: new Date(expiryStr),
      });
      expect(prisma.resaleListing.create).toHaveBeenCalledWith({
        data: expectedData,
      });
    });

    it('updates resale listing price and logs price audit history', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue({
        id: 'listing-1',
        sellerId: 'owner-1',
        status: 'ACTIVE',
        price: 1000n,
      });

      await service.updateResalePrice('owner-1', 'listing-1', '1500');

      expect(prisma.resalePriceHistory.create).toHaveBeenCalledWith({
        data: {
          resaleListingId: 'listing-1',
          price: 1500n,
        },
      });
      expect(prisma.resaleListing.update).toHaveBeenCalledWith({
        where: { id: 'listing-1' },
        data: { price: 1500n },
      });
    });

    it('fetches price history audit trail for a listing', async () => {
      prisma.resaleListing.findUnique.mockResolvedValue({ id: 'listing-1' });
      prisma.resalePriceHistory.findMany.mockResolvedValue([
        { id: 'h-1', price: 1000n },
        { id: 'h-2', price: 1500n },
      ]);

      const history = await service.getPriceHistory('listing-1');
      expect(history).toHaveLength(2);
      expect(prisma.resalePriceHistory.findMany).toHaveBeenCalledWith({
        where: { resaleListingId: 'listing-1' },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('cancels expired listings and restores ticket status to VALID', async () => {
      prisma.resaleListing.findMany.mockResolvedValue([
        { id: 'listing-exp-1', ticketId: 'ticket-exp-1' },
        { id: 'listing-exp-2', ticketId: 'ticket-exp-2' },
      ]);

      const res = await service.cancelExpiredListings();

      expect(res.cancelledCount).toBe(2);
      expect(prisma.resaleListing.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['listing-exp-1', 'listing-exp-2'] } },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ticket-exp-1', 'ticket-exp-2'] } },
        data: { status: 'VALID' },
      });
    });
  });

  describe('findMine', () => {
    it('scopes the query to the caller’s own tickets', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        { id: 'ticket-1', ownerId: 'owner-1' },
      ]);

      await service.findMine('owner-1');

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ownerId: 'owner-1' } }),
      );
    });
  });
});
