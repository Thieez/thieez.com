import { json, type RequestHandler } from '@sveltejs/kit';
import { AuthApiError, clearAuthCookies, getCurrentUser } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const session = await getCurrentUser(
      cookies,
      url,
      fetch,
      url.searchParams.get('refresh') === 'true'
    );
    return json(
      {
        user: session
          ? {
              name: typeof session.user.name === 'string' ? session.user.name : undefined,
              email: typeof session.user.email === 'string' ? session.user.email : undefined,
              avatar_url:
                typeof session.user.avatar_url === 'string' ? session.user.avatar_url : undefined
            }
          : null,
        is_admin: session?.user?.is_admin === true
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (cause) {
    console.error('Could not restore website auth session', cause);
    const status = cause instanceof AuthApiError && cause.status === 429
      ? 429
      : 502;
    const error = status === 429
      ? 'The session service is rate-limited. Please wait before trying again.'
      : 'Could not restore the session.';
    const retryAfter = cause instanceof AuthApiError ? cause.retryAfter : null;
    return json({ error }, {
      status,
      headers: {
        'cache-control': 'no-store',
        ...(retryAfter ? { 'retry-after': retryAfter } : {})
      }
    });
  }
};
