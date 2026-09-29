import { json, type RequestHandler } from '@sveltejs/kit';
import { clearAuthCookies, getCurrentUser } from '$lib/server/auth';

export const GET: RequestHandler = async ({ cookies, fetch, url }) => {
  try {
    const session = await getCurrentUser(cookies, url, fetch);
    return json(
      {
        user: session
          ? {
              name: typeof session.user.name === 'string' ? session.user.name : undefined,
              email: typeof session.user.email === 'string' ? session.user.email : undefined,
              avatar_url:
                typeof session.user.avatar_url === 'string' ? session.user.avatar_url : undefined
            }
          : null
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  } catch (cause) {
    console.error('Could not restore website auth session', cause);
    return json({ error: 'Could not restore the session.' }, {
      status: 502,
      headers: { 'cache-control': 'no-store' }
    });
  }
};
