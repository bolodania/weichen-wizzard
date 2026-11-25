// Approuter session CSRF protection for browser mutations.
const nativeFetch = window.fetch.bind(window);
let csrf;
let pending;
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
  const method = (options.method || input.method || 'GET').toUpperCase();
  if (url.origin === window.location.origin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrf) {
      pending ||= nativeFetch('/health', { headers: { 'X-CSRF-Token': 'Fetch' } })
        .then((response) => { csrf = response.headers.get('x-csrf-token'); })
        .finally(() => { pending = null; });
      await pending;
    }
    if (csrf) {
      const headers = new Headers(options.headers);
      headers.set('X-CSRF-Token', csrf);
      options = { ...options, headers };
    }
  }
  const response = await nativeFetch(input, options);
  if (response.status === 403 && response.headers.get('x-csrf-token')?.toLowerCase() === 'required') csrf = undefined;
  return response;
};