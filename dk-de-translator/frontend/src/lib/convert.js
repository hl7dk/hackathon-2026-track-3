// Placeholder for the translator. It returns a copy of the bundle unchanged;
// the real DK -> DE translation (codes, identifiers, German profiles) plugs in here.
export async function convert(bundle, target) {
  return { bundle: structuredClone(bundle), translated: false, target };
}
