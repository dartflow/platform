const boardIdPattern = /^(?:duindorp-baan-1|demo-[a-z0-9]{12,32})$/;

function qrResponse(url, id) {
  if (!boardIdPattern.test(id)) return new Response('Onbekende baan', {status: 404});
  const qr = new QRCode(-1, 1);
  const params = new URLSearchParams();
  for (const key of ['scheduled','name','opponent','first','startScore','bestOfLegs','boardTitle','venue']) {
    if (url.searchParams.has(key)) params.set(key, url.searchParams.get(key).slice(0, 70));
  }
  const query = params.size ? '?' + params : '';
  qr.addData(new URL('/#baan-phone/' + id + query, url.origin).href);
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
  }
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 8} ${size + 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="#10100f"/></svg>`, {
    headers: {'content-type': 'image/svg+xml', 'cache-control': 'public,max-age=300', 'x-content-type-options': 'nosniff'}
  });
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/baan/qr/')) return qrResponse(url, url.pathname.slice('/api/baan/qr/'.length));
    if (url.pathname.startsWith('/api/baan/')) return handleBaanApi(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, {status: 405});
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = Object.hasOwn(assets, path) ? assets[path] : null;
    if (!asset) return new Response('Pagina niet gevonden', {status: 404});
    const [type, data, binary] = asset;
    const body = request.method === 'HEAD' ? null : binary ? Uint8Array.from(atob(data), value => value.charCodeAt(0)) : data;
    return new Response(body, {headers: {
      'content-type': type, 'cache-control': 'public,max-age=0,must-revalidate', 'x-content-type-options': 'nosniff'
    }});
  }
};
