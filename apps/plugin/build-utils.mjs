import { access, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function backendOriginFor(value) {
  const parsed = new URL(value);
  if (!parsed.origin || parsed.origin === 'null')
    throw new Error('BACKEND_BASE_URL must be a valid URL.');
  return parsed.origin;
}

export function validateNetworkAccess(manifest, mode, backendOrigin) {
  const network = manifest.networkAccess;
  if (!network || typeof network !== 'object')
    throw new Error('Generated manifest is missing networkAccess.');
  const allowedDomains = Array.isArray(network.allowedDomains) ? network.allowedDomains : [];
  const devAllowedDomains = Array.isArray(network.devAllowedDomains)
    ? network.devAllowedDomains
    : [];
  const backend = new URL(backendOrigin);
  const host = backend.hostname.toLowerCase();
  if (mode === 'development') {
    if (allowedDomains.length !== 1 || allowedDomains[0] !== 'none')
      throw new Error('Development manifest must use allowedDomains=["none"].');
    if (!devAllowedDomains.includes(backendOrigin))
      throw new Error(
        `Development manifest must allow ${backendOrigin} through devAllowedDomains.`,
      );
    if (LOOPBACK_HOSTS.has(host) && !backendOrigin.startsWith('http://localhost'))
      throw new Error(
        'Development Figma network access must use http://localhost, not a loopback IP.',
      );
    if (devAllowedDomains.some((domain) => domain.includes('127.0.0.1')))
      throw new Error('Development manifest must not contain 127.0.0.1.');
    return;
  }
  if (backend.protocol !== 'https:') throw new Error('Production BACKEND_BASE_URL must use HTTPS.');
  if (devAllowedDomains.length > 0)
    throw new Error('Production manifest must not contain devAllowedDomains.');
  if (allowedDomains.length !== 1 || allowedDomains[0] !== backendOrigin)
    throw new Error('Production manifest must allow only the configured HTTPS backend origin.');
  if (allowedDomains.some((domain) => /localhost|127\.0\.0\.1|::1|\*/u.test(domain)))
    throw new Error(
      'Production manifest must not contain localhost, loopback, or wildcard domains.',
    );
}

export async function validateBuiltManifest(distManifestPath, { mode, backendOrigin }) {
  const text = await readFile(distManifestPath, 'utf8');
  const manifest = JSON.parse(text);
  if (distManifestPath.split('/').at(-1) !== 'manifest.json')
    throw new Error('The runnable Figma manifest must be named manifest.json.');
  if (manifest.api !== '1.0.0')
    throw new Error('Generated Figma plugin manifests must target API version 1.0.0.');
  const distDirectory = resolve(distManifestPath, '..');
  for (const field of ['main', 'ui']) {
    if (typeof manifest[field] !== 'string' || !manifest[field])
      throw new Error(`Generated manifest is missing ${field}.`);
    const target = resolve(distDirectory, manifest[field]);
    const pathFromDist = relative(distDirectory, target);
    if (pathFromDist.startsWith('..') || isAbsolute(pathFromDist))
      throw new Error(`Generated manifest ${field} must remain inside dist/.`);
    await access(target);
  }
  validateNetworkAccess(manifest, mode, backendOrigin);
  return manifest;
}
