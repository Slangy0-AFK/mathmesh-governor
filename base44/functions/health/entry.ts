export default function (req: Request): Response {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  return Response.json({ status: 'ok' }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}