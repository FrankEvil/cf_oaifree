export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/auth/login_auth0') {
            return Response.redirect('https://login.xxxx.workers.dev', 301); //修改xxx为你的cloudflare用户名
        }


        if (url.pathname === '/auth/login') {
            const token = url.searchParams.get('token');
            if (!token) {
                return Response.redirect('https://login.xxxx.workers.dev', 301); //修改xxx为你的cloudflare用户名
            }
            url.host = 'new.oaifree.com';
            return fetch(new Request(url, request));
        }

        url.host = 'new.oaifree.com';
        return fetch(new Request(url, request));
    }
}