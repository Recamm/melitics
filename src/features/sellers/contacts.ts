import { historySnapshotSchema, publicSellerIdSchema, sellerContactKey, sellerContactSchema, type PublicPageSnapshot, type SellerContact } from '../../shared/contracts';

export function contactCandidate(value: PublicPageSnapshot): SellerContact | null {
	const parsed = historySnapshotSchema.safeParse(value);
	if (!parsed.success || !parsed.data.seller?.id || !parsed.data.seller.url) return null;
	const snapshot = parsed.data;
	const contact = { siteId: 'MLA' as const, sellerId: snapshot.seller!.id!, field: 'profile' as const, value: snapshot.seller!.url!,
		sourceUrl: snapshot.canonicalUrl, observedAt: snapshot.observedAt,
		expiresAt: new Date(Date.parse(snapshot.observedAt) + 30 * 86400000).toISOString(), verification: 'unconfirmed' as const };
	const result = sellerContactSchema.safeParse({ ...contact, key: sellerContactKey(contact) });
	return result.success ? result.data : null;
}
export function contactsForSeller(values: unknown[], sellerId: string, now = new Date()): (SellerContact & { expired: boolean })[] {
	publicSellerIdSchema.parse(sellerId);
	if (values.length > 1000 || !Number.isFinite(now.getTime())) throw new Error('Invalid contact collection');
	const latest = new Map<string, SellerContact>();
	for (const value of values) {
		const parsed = sellerContactSchema.safeParse(value);
		if (!parsed.success || parsed.data.sellerId !== sellerId) continue;
		const previous = latest.get(parsed.data.key);
		if (!previous || parsed.data.observedAt > previous.observedAt) latest.set(parsed.data.key, parsed.data);
	}
	return [...latest.values()].map(contact => ({ ...contact, expired: Date.parse(contact.expiresAt) <= now.getTime() }));
}