export const delegateCapabilities = [
 'unicode.lookup', 'raster.read', 'settings.youhavecode.read',
 'storage.profile.read', 'storage.profile.write', 'editor.selection.read',
 'workspace.text.read', 'workspace.text.write', 'network.fetch',
 'commands.execute', 'process.spawn', 'extensionHost.fullAccess',
] as const;

export type DelegateCapability = typeof delegateCapabilities[number];
export type DelegatePreset = 'restricted' | 'workspace-read' | 'full-access';

export interface DelegateLimits {
 timeoutMs: number;
 memoryMb: number;
 maxOutputCells: number;
}

export interface DelegateProfileConfig {
 extends?: DelegatePreset;
 allow?: DelegateCapability[];
 deny?: DelegateCapability[];
 limits?: Partial<DelegateLimits>;
}

export interface ResolvedDelegateProfile {
 name: string;
 preset: DelegatePreset;
 capabilities: ReadonlySet<DelegateCapability>;
 limits: DelegateLimits;
 trusted: boolean;
}

export const builtInDelegateProfiles: Readonly<Record<DelegatePreset, readonly DelegateCapability[]>> = {
 restricted: ['unicode.lookup', 'raster.read', 'settings.youhavecode.read'],
 'workspace-read': ['unicode.lookup', 'raster.read', 'settings.youhavecode.read', 'storage.profile.read', 'editor.selection.read', 'workspace.text.read'],
 'full-access': delegateCapabilities,
};

const defaultLimits: DelegateLimits = { timeoutMs: 500, memoryMb: 32, maxOutputCells: 20_000 };

export function resolveDelegateProfile(name: string, profiles: Readonly<Record<string, DelegateProfileConfig>> = {}): ResolvedDelegateProfile {
 const custom = profiles[name];
 const preset = custom?.extends ?? (isDelegatePreset(name) ? name : 'restricted');
 const capabilities = new Set<DelegateCapability>(builtInDelegateProfiles[preset]);
 custom?.allow?.forEach(capability => capabilities.add(capability));
 custom?.deny?.forEach(capability => capabilities.delete(capability));
 const trusted = capabilities.has('extensionHost.fullAccess');
 return {
  name, preset, capabilities,
  limits: {
   timeoutMs: bounded(custom?.limits?.timeoutMs, 10, 30_000, defaultLimits.timeoutMs),
   memoryMb: bounded(custom?.limits?.memoryMb, 8, 512, defaultLimits.memoryMb),
   maxOutputCells: bounded(custom?.limits?.maxOutputCells, 1, 1_000_000, defaultLimits.maxOutputCells),
  },
  trusted,
 };
}

function isDelegatePreset(value: string): value is DelegatePreset {
 return value === 'restricted' || value === 'workspace-read' || value === 'full-access';
}

function bounded(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
 return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value!))) : fallback;
}