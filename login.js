//检索“修改”，其内容为需在部署时修改的
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

function isTokenExpired(token) {
    if (!token || token === "Bad_RT") {
        return true;
    }
    const payload = parseJwt(token);
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp < currentTime;
}

async function getOAuthLink(shareToken, proxiedDomain) {
    const url = `https://new.oaifree.com/api/auth/oauth_token`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Origin': `https://${proxiedDomain}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            share_token: shareToken
        })
    })
    const data = await response.json();
    return data.login_url;
}

async function usermatch(userName, usertype) {
    // @ts-ignore
    const typeUsers = await oai_global_variables.get(usertype);
    return (userName.split(",").includes(typeUsers))
}

async function getShareToken(userInfo, accessToken) {
    const url = 'https://chat.oaifree.com/token/register';
    let user = userInfo;
    if (userInfo === 'atdirect') {
        user = {
            "userToken": "@atdirect@",
            "gpt35Limit": -1,
            "gpt4Limit": -1,
            "expireIn": 0,
            "sessionIsolation": true,
            "temporarySession": false,
        }
    }
    const tokenPrefix = await oai_global_variables.get('token_prefix');
    const baseUserName = tokenPrefix + user.userToken.replace(/_\d+$/, ''); // 移除用户名后的编号
//此段代码控制sharetoken的权限，可根据实际情况修改
    const body = new URLSearchParams({
        access_token: accessToken,
        unique_name: baseUserName,
        site_limit: '', // 限制的网站
        expires_in: user.expireIn, // token有效期（单位为秒），填 0 则永久有效
        gpt35_limit: user.gpt35Limit, // gpt3.5 对话限制
        gpt4_limit: user.gpt4Limit, // gpt4 对话限制，-1为不限制
        show_conversations: !user.sessionIsolation, // 是否显示所有人的会话
        temporary_chat: user.temporarySession, //默认启用临时聊天
        show_userinfo: !user.sessionIsolation, // 是否显示用户信息
        reset_limit: 'false' // 是否重置对话限制
    }).toString();
    const apiResponse = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body
    });
    const responseText = await apiResponse.text();
    const tokenKeyMatch = /"token_key":"([^"]+)"/.exec(responseText);
    return tokenKeyMatch ? tokenKeyMatch[1] : null;
}

async function handleRequest(request) {
    if (request.method === 'GET') {
        return handleGetRequest(request);
    } else if (request.method === 'POST') {
        return handlePostRequest(request);
    } else {
        return new Response('Method not allowed', {status: 405});
    }
}

async function handleGetRequest(request) {
    let tokenInfos = await getDicts("token_");
    let tokenStr = '';
    for (const tokenInfo of tokenInfos) {
        let expire = !tokenInfo.refreshToken && isTokenExpired(tokenInfo.accessToken);
        tokenStr += `<div class="block" data-id="${tokenInfo.tokenAccount}" data-expire="${expire}" style="background-color:${expire ? '#c14b1287' :
            '#2dc11287'} ">
        <div class="block-header" >
            <span class="badge  ${tokenInfo.plus ? 'badge-plus' : 'badge-gpt'}">${tokenInfo.plus ? 'Plus' : '3.5'}</span>
            <span>${tokenInfo.tokenName}</span>
        </div>
        <div class="status">实时状态：${expire ? '过期' : '可用'}</div>
        </div>`
    }
    const html = await getHTML({
        "tokenStr": tokenStr,
    });
    return new Response(html, {headers: {'Content-Type': 'text/html'}});
}

async function handlePostRequest(request) {
    const formData = await request.formData();
    const userToken = formData.get('userToken');
    const tokenAccount = formData.get('tokenAccount');
    const turnstileResponse = formData.get('cf-turnstile-response');
    return await handleLogin(userToken, tokenAccount, turnstileResponse);
}

async function handleLogin(userToken, tokenAccount, turnstileResponse) {
    //Turnsile认证
    if (turnstileResponse !== 'do not need Turnstle' && (!turnstileResponse || !await verifyTurnstile(turnstileResponse))) {
        return new Response('Turnstile verification failed', {status: 403});
    }

    // @ts-ignore
    const proxiedDomain = 'new.xxxxx.workers.dev'; //xxx改为CF用户名修改为反代new站的地址（不加https！！！）

    // 如果输入用户名长度大于50，直接视作accessToken
    if (userToken.length > 50) {
        // 如果输入用户名fk开头，直接视作sharetoken
        if (userToken.startsWith('fk-')) {
            return Response.redirect(await getOAuthLink(userToken, proxiedDomain), 302);
        }
        let token = parseJwt(userToken);
        if (token == null) {
            return new Response('用户token错误', {status: 403});
        }
        const shareToken = await getShareToken('atdirect', userToken, '0');
        if (shareToken === null) {
            return new Response(`获取分享token失败请稍后重试`, {status: 500});
        }
        return Response.redirect(await getOAuthLink(shareToken, proxiedDomain), 302);
    }
    let userInfo = await oai_global_variables.get(`user_${userToken}`);
    let tokenInfo = await oai_global_variables.get(`token_${tokenAccount}`);
    if (!userInfo) {
        return new Response('用户token错误', {status: 403});
    }
    if (!tokenInfo) {
        return new Response('tokenAccount错误', {status: 403});
    }
    userInfo = JSON.parse(userInfo);
    tokenInfo = JSON.parse(tokenInfo);
    if (!userInfo.allToken) {
        if (userInfo.tokens && userInfo.tokens.length > 0) {
            // 使用 find 方法查找
            const some = userInfo.tokens.find(item => item.tokenAccount === tokenAccount);
            if (!some) {
                return new Response('用户没有该账号的权限', {status: 403});
            }
        } else {
            return new Response('用户没有该账号的权限', {status: 403});
        }
    }
    if (isTokenExpired(tokenInfo.accessToken)) {
        if (tokenInfo.refreshToken) {
            const url = 'https://token.oaifree.com/api/auth/refresh';
            const refreshToken = tokenInfo.refreshToken;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: `refresh_token=${refreshToken}`
            });

            if (response.ok) {
                const data = await response.json();
                const newAccessToken = data.access_token;
                tokenInfo.accessToken = newAccessToken;
                // @ts-ignore
                await oai_global_variables.put(`token_${tokenInfo.tokenAccount}`, JSON.stringify(tokenInfo));
            } else {
                return new Response('Error fetching access token', {status: response.status});
            }
        } else {
            return new Response('账号过期了', {status: response.status});
        }
    }
    const shareToken = await getShareToken(userInfo, tokenInfo.accessToken);
    if (shareToken === null) {
        return new Response('Error fetching share token.', {status: 500});
    }
    userInfo.shareToken = shareToken;
    await oai_global_variables.put(`user_${userInfo.userToken}`, JSON.stringify(userInfo));
    return Response.redirect(await getOAuthLink(shareToken, proxiedDomain), 302);
}

async function verifyTurnstile(responseToken) {
    const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    // @ts-ignore
    const secretKey = await oai_global_variables.get('turnstilekeys');
    const response = await fetch(verifyUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            secret: secretKey,
            response: responseToken
        })
    });
    const data = await response.json();
    return data.success;
}

async function getDicts(prefix) {
    const KV = await oai_global_variables.list();
    const dicts = KV.keys.filter(key => key.name.startsWith(prefix));
    console.log(dicts)
    let data = [];
    for (let index in dicts) {
        const dictStr = await oai_global_variables.get(dicts[index].name)
        try {
            const info = JSON.parse(dictStr);
            data.push(info);
        } catch (e) {
            // 输入不是 JSON 格式
        }
    }
    return data;
}

async function getHTML(data) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pandora AI Blocks</title>
    <style>
        body {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 16px;
            margin: 0;
            font-family: Arial, sans-serif;
            background-color: #f0f0f0;
        }
        .header {
            margin-bottom: 24px;
            text-align: center;
            padding: 16px;
            background-color: #fff;
            border-radius: 8px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            width: 80%;
            max-width: 1000px;
        }
        .header img {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            margin-bottom: 16px;
        }
        .header h1 {
            margin: 0 0 16px;
        }
        .header a {
            color: #3498db;
            text-decoration: none;
        }
        .container {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            justify-content: left;
            max-width: 1000px;
            width: 100%;
        }
        .block {
            flex: 0 1 calc(25% - 16px);
            box-sizing: border-box;
            padding: 16px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            background-color: #fff;
            text-align: left;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
            cursor: pointer;
        }
        .block-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .block-header .badge {
            padding: 2px 8px;
            border-radius: 12px;
            color: #fff;
        }
        .badge-plus {
            background-color: #e3ab0b;
        }
        .badge-gpt {
            background-color: #27ae60;
        }
        .status {
            margin-top: 8px;
            font-size: 14px;
            color: #7f8c8d;
        }
        .bars {
            display: flex;
            justify-content: space-around;
            margin-top: 8px;
        }
        .bar {
            height: 4px;
            width: 24px;
            border-radius: 2px;
        }
        .bar-purple {
            background-color: #8e44ad;
        }
        .bar-green {
            background-color: #27ae60;
        }
        .bar-orange {
            background-color: #f39c12;
        }
        @media (max-width: 768px) {
            .block {
                flex: 0 1 calc(50% - 16px);
            }
        }
        @media (max-width: 480px) {
            .block {
                flex: 0 1 calc(100% - 16px);
            }
        }
        .modal {
            display: none;
            position: fixed;
            z-index: 1;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(0, 0, 0, 0.4);
            padding-top: 60px;
        }
        .modal-content {
            background-color: #fefefe;
            margin: 5% auto;
            padding: 20px;
            border: 1px solid #888;
            width: 80%;
            max-width: 400px;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
        }
        .close:hover,
        .close:focus {
            color: black;
            text-decoration: none;
            cursor: pointer;
        }
        .modal-content h2 {
            margin-top: 0;
        }
        .modal-content form {
            display: flex;
            flex-direction: column;
        }
        .modal-content label {
            margin-bottom: 8px;
            font-weight: bold;
        }
        .modal-content input[type="text"] {
            padding: 8px;
            margin-bottom: 16px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 16px;
        }
        .modal-content button {
            padding: 10px 15px;
            border: none;
            border-radius: 4px;
            background-color: #27ae60;
            color: #fff;
            font-size: 16px;
            cursor: pointer;
        }
        .modal-content button:hover {
            background-color: #219150;
        }
    </style>
</head>
<body>

<div class="header">
     <a href="https://admin.xxxxx.workers.dev" target="_blank"><img src="这个头像地址" alt="Shawn AI"></a>
    <h1>Pandora AI</h1>
    <p>chatgpt账号合集<br>
    </p>
</div>

<div class="container">
    <!-- Block 1 -->
    ${data.tokenStr}
    <!-- Add more blocks as needed -->
</div>

<div id="tokenModal" class="modal">
    <div class="modal-content">
        <span class="close" id="closeModal">&times;</span>
        <h2>Welcome Back</h2>
        <form id="tokenForm" action="/" method="POST"> 
            <input type="hidden" id="cf-turnstile-response" name="cf-turnstile-response" required>
            <input type="text" id="userToken" name="userToken" placeholder="请输入您的UserToken" required>
            <input type="hidden" id="blockId" name="tokenAccount">
            <button type="submit">继续</button>
            <div style="height: 20px;"></div>
           <div class="cf-turnstile" data-sitekey="自己的cf-turnstile密钥" data-callback="onTurnstileCallback"></div> 
        </form>
    </div>
</div>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script>
    document.querySelectorAll('.block').forEach(block => {
        block.addEventListener('click', function() {
            const blockId = this.getAttribute('data-id');
            const  expire = this.getAttribute("data-expire");
            if(expire != 'true'){ 
                document.getElementById('blockId').value = blockId;
                document.getElementById('tokenModal').style.display = 'block';
            }
        });
    });
    function onTurnstileCallback(token) {
        document.getElementById('cf-turnstile-response').value = token;
    }
    document.getElementById('closeModal').addEventListener('click', function() {
        document.getElementById('tokenModal').style.display = 'none';
    });

    document.getElementById('tokenForm').addEventListener('submit', function(event) {
        if (!document.getElementById('cf-turnstile-response').value) {
             event.preventDefault();
            alert('Please complete the verification.');
        }
    });
    
</script>

</body>
</html>
`
}
