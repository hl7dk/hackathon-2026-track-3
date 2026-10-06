// Settings live in ../../config.yml; this only parses them.
import { parse } from 'yaml';
import raw from '../../config.yml?raw';

const config = parse(raw);

export const { testUsers: TEST_USERS, wallet: WALLET, cprSystem: CPR_SYSTEM, sources: SOURCES, targets: TARGETS, transform: TRANSFORM, scopes: SCOPES, purposes: PURPOSES, systemLabels: SYSTEM_LABELS } = config;
export const SERVERS = [...SOURCES, ...TARGETS];
