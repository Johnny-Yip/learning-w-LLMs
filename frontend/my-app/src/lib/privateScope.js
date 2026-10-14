import { getAuthGeneration } from './authApi';

let ownerId = null;
let revision = 0;
const listeners = new Set();
export const getPrivateOwner = () => ownerId;
export const subscribePrivateScope = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function setPrivateOwner(nextOwner) {
  nextOwner = nextOwner == null ? null : String(nextOwner);
  if (nextOwner === ownerId) return;
  ownerId = nextOwner;
  revision += 1;
  // Signup already captured its draft before authentication succeeds.
  // Anonymous onboarding reloads do not cross an account boundary.
  sessionStorage.removeItem('pendingSignup');
  listeners.forEach(listener => listener(ownerId));
}
export const capturePrivateScope = () => ({ ownerId, revision, generation: getAuthGeneration() });
export const isPrivateScopeCurrent = scope => scope.ownerId === ownerId &&
  scope.revision === revision && scope.generation === getAuthGeneration();
export function assertPrivateScope(scope) {
  if (!isPrivateScopeCurrent(scope)) {
    const error = new Error('Authentication request cancelled');
    error.code = 'AUTH_CANCELLED';
    throw error;
  }
}

// Bind each store action's reads, writes and deferred callbacks to its initiating account.
export function scopedActions(build, set, get) {
  const state = build(set, get);
  return Object.fromEntries(Object.entries(state).map(([name, value]) => {
    if (typeof value !== 'function') return [name, value];
    return [name, (...args) => {
      const scope = capturePrivateScope();
      const bound = build(
        (...updates) => { assertPrivateScope(scope); return set(...updates); },
        () => { assertPrivateScope(scope); return get(); }
      );
      const result = bound[name](...args);
      if (result && typeof result.then === 'function') {
        return result.then(data => { assertPrivateScope(scope); return data; }, error => {
          assertPrivateScope(scope);
          throw error;
        });
      }
      assertPrivateScope(scope);
      return result;
    }];
  }));
}

// Preserve the Response interface while checking delayed body reads and streaming chunks.
function scopedReader(reader, scope) {
  return new Proxy(reader, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === 'read') return async (...args) => {
        assertPrivateScope(scope);
        const data = await value.apply(target, args);
        assertPrivateScope(scope);
        return data;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
function scopedResponse(response, scope) {
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (['json', 'text', 'blob', 'arrayBuffer', 'formData'].includes(property)) return async (...args) => {
        assertPrivateScope(scope);
        const data = await value.apply(target, args);
        assertPrivateScope(scope);
        return data;
      };
      if (property === 'clone') return () => scopedResponse(value.call(target), scope);
      if (property === 'body' && value) return new Proxy(value, {
        get(stream, key) {
          const member = Reflect.get(stream, key, stream);
          if (key === 'getReader') return (...args) => {
            assertPrivateScope(scope);
            return scopedReader(member.apply(stream, args), scope);
          };
          return typeof member === 'function' ? member.bind(stream) : member;
        },
      });
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
export async function guardedFetch(...args) {
  const scope = capturePrivateScope();
  const response = await fetch(...args);
  assertPrivateScope(scope);
  return scopedResponse(response, scope);
}
