import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

export const preferencesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  panelEnabled: z.boolean(),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  schemaVersion: 1,
  panelEnabled: true,
};

export const runtimeStatusSchema = z.strictObject({
  completedMilestone: z.literal(1),
  mode: z.literal('local'),
  networkEnabled: z.literal(false),
  capabilities: z.strictObject({
    analysis: z.literal('unavailable'),
    history: z.literal('unavailable'),
    assistant: z.literal('disabled'),
  }),
});

export const RUNTIME_STATUS: z.infer<typeof runtimeStatusSchema> = {
  completedMilestone: 1,
  mode: 'local',
  networkEnabled: false,
  capabilities: {
    analysis: 'unavailable',
    history: 'unavailable',
    assistant: 'disabled',
  },
};

export const errorCodeSchema = z.enum([
  'invalid-input',
  'forbidden',
  'unsupported',
  'unavailable',
  'timeout',
  'rate-limited',
  'storage-full',
  'internal',
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;