export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'base44:runtime') {
    return {
      url: new URL('./base44-runtime-stub.js', import.meta.url).href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}