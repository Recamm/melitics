import { z } from 'zod';
import { historySnapshotSchema, marketplaceIdSchema, offerSourceSchema, type PublicPageSnapshot } from '../../shared/contracts';
import { marketplaceUrl, pageIdentity } from '../../platforms/mercadolibre/markets';

export const ASSISTANT_POLICY = Object.freeze({ provider: null, monthlyBudgetUsd: 0, hosting: 'local-only', dataPolicy: 'no-transmission', enabled: false } as const);
export const assistantTaskSchema = z.enum(['title', 'description', 'attributes']);
export type AssistantTask = z.infer<typeof assistantTaskSchema>;
export const assistantPreferencesSchema = z.strictObject({ locale: z.literal('es-AR'), tone: z.enum(['neutral', 'concise']) });
export const assistantRequestSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.uuid(), task: assistantTaskSchema,
  product: z.strictObject({
    siteId: z.literal('MLA'), listingId: marketplaceIdSchema.nullable(), productId: marketplaceIdSchema.nullable(),
    title: z.string().trim().min(1).max(500).refine(value => !/<(?:!doctype|html|head|body)\b/i.test(value)),
    canonicalUrl: offerSourceSchema.shape.url, observedAt: offerSourceSchema.shape.observedAt,
  }).refine(product => {
    const url = marketplaceUrl(product.canonicalUrl); const identity = url && pageIdentity(url);
    return identity && product.listingId !== product.productId && (identity.kind === 'listing' ? product.listingId === identity.listingId : product.productId === identity.productId);
  }),
  preferences: assistantPreferencesSchema,
});
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

function proposedText(maximum: number) { return z.strictObject({ text: z.string().trim().min(1).max(maximum), sources: z.array(offerSourceSchema.shape.url).max(8) }); }
export const assistantProposalSchema = z.strictObject({
  schemaVersion: z.literal(1), requestId: z.uuid(), task: assistantTaskSchema,
  title: proposedText(500).nullable(), description: proposedText(5000).nullable(),
  attributes: z.array(z.strictObject({ name: z.string().trim().min(1).max(100), value: proposedText(500) })).max(40),
}).refine(proposal => proposal.task === 'title' ? proposal.title !== null && proposal.description === null && proposal.attributes.length === 0
  : proposal.task === 'description' ? proposal.description !== null && proposal.title === null && proposal.attributes.length === 0
    : proposal.title === null && proposal.description === null && proposal.attributes.length > 0)
  .refine(proposal => new Set(proposal.attributes.map(attribute => attribute.name.toLocaleLowerCase('es-AR'))).size === proposal.attributes.length);
export type AssistantProposalPayload = z.infer<typeof assistantProposalSchema>;
export type AssistantText = NonNullable<AssistantProposalPayload['title']> & { verified: false };
export type AssistantProposal = Omit<AssistantProposalPayload, 'title' | 'description' | 'attributes'> & {
  title: AssistantText | null; description: AssistantText | null; attributes: { name: string; value: AssistantText }[];
};

export function buildAssistantRequest(value: PublicPageSnapshot, task: AssistantTask, preferences: z.infer<typeof assistantPreferencesSchema> = { locale: 'es-AR', tone: 'neutral' }): AssistantRequest {
  const snapshot = historySnapshotSchema.parse(value);
  return assistantRequestSchema.parse({ schemaVersion: 1, requestId: crypto.randomUUID(), task,
    product: { siteId: snapshot.siteId, listingId: snapshot.listingId, productId: snapshot.productId, title: snapshot.title, canonicalUrl: snapshot.canonicalUrl, observedAt: snapshot.observedAt }, preferences });
}
export function validateAssistantRequest(value: unknown): AssistantRequest { return assistantRequestSchema.parse(value); }
export function validateAssistantProposal(value: unknown, input: unknown): AssistantProposal {
  const request = validateAssistantRequest(input); const proposal = assistantProposalSchema.parse(value);
  if (proposal.requestId !== request.requestId || proposal.task !== request.task) throw new Error('Proposal request mismatch');
  function validateText(text: NonNullable<AssistantProposalPayload['title']>): AssistantText {
    if (text.sources.some(url => url !== request.product.canonicalUrl)) throw new Error('Unapproved proposal source');
    return { ...text, verified: false };
  }
  return { ...proposal, title: proposal.title ? validateText(proposal.title) : null, description: proposal.description ? validateText(proposal.description) : null,
    attributes: proposal.attributes.map(attribute => ({ name: attribute.name, value: validateText(attribute.value) })) };
}
export function createAssistantClient() {
  return { async generate(request: unknown, options: { consent: boolean; signal: AbortSignal }) {
    if (options.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    validateAssistantRequest(request);
    z.boolean().parse(options.consent);
    return { status: 'disabled' as const, reason: 'no-provider' as const, proposal: null };
  } };
}