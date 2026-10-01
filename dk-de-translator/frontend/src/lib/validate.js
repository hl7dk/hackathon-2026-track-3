// Validation through the HAPI servers' $validate, one resource at a time.
// Each server has its own IGs loaded, so the server you pick decides the rules.

// server: an entry from sources or targets in config.yml.
// A resource with a profile for its type in server.profiles is checked as if it
// claimed that profile (meta.profile replaced), the same mapping as the CLI validators.
export async function validateBundle(bundle, server, onProgress = () => {}) {
  const resources = (bundle.entry ?? []).map((e) => e.resource);
  const results = [];
  for (const [i, resource] of resources.entries()) {
    onProgress(i + 1, resources.length);
    const profile = server.profiles?.[resource.resourceType];
    const body = structuredClone(resource);
    if (profile) body.meta = { ...body.meta, profile: [profile] };
    results.push({ resource, profile: profile ?? resource.meta?.profile?.[0] ?? null, issues: await validateOne(body, server.url) });
  }
  return results;
}

async function validateOne(resource, baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/${resource.resourceType}/$validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json' },
      body: JSON.stringify(resource),
    });
    // HAPI answers 412 with an OperationOutcome when there are errors.
    const outcome = await res.json().catch(() => null);
    if (outcome?.resourceType === 'OperationOutcome') return outcome.issue ?? [];
    return [{ severity: 'error', diagnostics: `${res.status} ${res.statusText}, no OperationOutcome returned` }];
  } catch (err) {
    return [{ severity: 'error', diagnostics: `Could not reach ${baseUrl}: ${err.message}` }];
  }
}
