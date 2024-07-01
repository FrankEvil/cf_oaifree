/**
 * @param {string} PASSWORD A name of an area (a page or a group of pages) to protect.
 * Some browsers may show "Enter user name and password to access REALM"
 */
const REALM = 'Secure Area'
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

/**
 * Break down base64 encoded authorization string into plain-text username and password
 * @param {string} authorization
 * @returns {string[]}
 */
function parseCredentials(authorization) {
    const parts = authorization.split(' ')
    const plainAuth = atob(parts[1])
    const credentials = plainAuth.split(':')

    return credentials
}

/**
 * Helper funtion to generate Response object
 * @param {string} message
 * @returns {Response}
 */
function getUnauthorizedResponse(message) {
    let response = new Response(message, {
        status: 401,
    })

    response.headers.set('WWW-Authenticate', `Basic realm="${REALM}"`)

    return response
}

async function checkBaseAuth(request) {
    const authorization = request.headers.get('authorization')

    if (!request.headers.has('authorization')) {
        return getUnauthorizedResponse(
            'Provide User Name and Password to access this page.',
        )
    }

    const credentials = parseCredentials(authorization)

    const adminUserName = await oai_global_variables.get('adminUserName')
    const adminPwd = await oai_global_variables.get('adminPwd')

    if (credentials[0] !== adminUserName || credentials[1] !== adminPwd) {
        return getUnauthorizedResponse(
            'The User Name and Password combination you have entered is invalid.',
        )
    }
    return null;
}

/**
 * @param {Request} request
 * @returns {Response}
 */
async function handleRequest(request) {
    const res = await checkBaseAuth(request);
    if (res) {
        return res;
    }
    if (request.method === 'GET') {
        const tokenData = await getTokenData();
        const userData = await getUserData();

        const html = await getHTML(tokenData, userData);
        return new Response(html, {headers: {'Content-Type': 'text/html'}});
    } else if (request.method === 'POST') {
        const url = new URL(request.url);
        if (url.pathname === '/token') {
            return saveOrUpdateToken(request);
        } else if (url.pathname === '/user') {
            return saveOrUpdateUser(request);
        } else {
            url.pathname = '/';
            return new Response('错误路径', {status: 500});
        }
    } else if (request.method === 'DELETE') {
        const url = new URL(request.url);
        if (url.pathname === '/token') {
            return deleteToken(request);
        } else if (url.pathname === '/user') {
            return deleteUser(request)
        } else {
            url.pathname = '/';
            return new Response('错误路径', {status: 500});
        }
    }

}

async function saveOrUpdateToken(request) {
    const body = await request.json();
    if (!body.token || !body.tokenAccount) {
        return returnJson(500, "token或唯一名不能为空");
    }

    let tokenInfo = {
        "tokenAccount": body.tokenAccount,
        "tokenName": body.tokenName,
        "plus": body.plus == 'true'
    }
    const key = `token_${body.tokenAccount}`;
    //长度操作50 是accessToken
    if (body.token.length > 50) {
        const payload = parseJwt(body.token);
        if (payload == null) {
            return returnJson(500, "不是合法的accessToken");
        }
        tokenInfo['accessToken'] = body.token;
    } else {
        let accessToken = await refreshTokenToAccessToke(body.token);
        if (!accessToken) {
            return returnJson(500, "不是合法的refreshToken");
        }
        tokenInfo['accessToken'] = accessToken;
        tokenInfo['refreshToken'] = body.token;
    }
    await oai_global_variables.put(key, JSON.stringify(tokenInfo));
    return returnJson(200, "保存成功");
}

async function saveOrUpdateUser(request) {
    const body = await request.json();
    if (!body.userToken) {
        return returnJson(500, "用户token不能为空");
    }
    let userInfo = {
        "userName": body.userName,
        "userToken": body.userToken,
        "expireIn": body.expireIn,
        "gpt35Limit": body.gpt35Limit,
        "gpt4Limit": body.gpt4Limit,
        "sessionIsolation": body.sessionIsolation == 'true',
        "temporarySession": body.temporarySession == 'true',
        "allToken": body.allToken == 'true'
    }
    if (!userInfo.allToken && body.tokens && body.tokens.length > 0) {
        const tokenDicts = await getDicts('token_');
        let tokens = [];
        const tokenMap = transformArrayToObject(tokenDicts, 'tokenAccount');
        for (let token of body.tokens) {
            let tokenInfo = tokenMap[token]
            if (tokenInfo) {
                tokens.push({
                    "tokenAccount": tokenInfo.tokenAccount,
                    "tokenName": tokenInfo.tokenName,
                })
            }
        }
        userInfo['tokens'] = tokens;
    }
    const key = `user_${body.userToken}`;
    await oai_global_variables.put(key, JSON.stringify(userInfo));
    return returnJson(200, "保存成功");
}

async function deleteToken(request) {
    const body = await request.json();
    if (!body.tokenAccount) {
        return returnJson(500, "token唯一名不能为空");
    }
    const key = `token_${body.tokenAccount}`;
    await oai_global_variables.delete(key);
    return returnJson(200, "删除成功");
}

async function deleteUser(request) {
    const body = await request.json();
    if (!body.userToken) {
        return returnJson(500, "用户token不能为空");
    }
    const key = `user_${body.userToken}`;
    await oai_global_variables.delete(key);
    return returnJson(200, "删除成功");
}

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

function betweenDay(milliseconds) {
    let currentTime = Date.now();
    let timeDifference = milliseconds - currentTime;
    return Math.floor(timeDifference / (1000 * 60 * 60 * 24));
}

function formatDate(milliseconds) {
    let date = new Date(milliseconds);
    let yy = date.getFullYear().toString().slice(-2);
    let MM = (date.getMonth() + 1).toString().padStart(2, '0'); // 月份从0开始
    let dd = date.getDate().toString().padStart(2, '0');
    let HH = date.getHours().toString().padStart(2, '0');
    let mm = date.getMinutes().toString().padStart(2, '0');
    let ss = date.getSeconds().toString().padStart(2, '0');

    return `${yy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
}

async function refreshTokenToAccessToke(refreshToken) {
    const url = 'https://token.oaifree.com/api/auth/refresh';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: `refresh_token=${refreshToken}`
    });

    if (response.ok) {
        const data = await response.json();
        return data.access_token;
    } else {
        return null;
    }
}

function returnJson(status, message, data) {
    const res = {
        "status": status,
        "message": message,
        "data": data
    };
    return new Response(JSON.stringify(res), {
        headers: {
            'content-type': 'application/json'
        }
    });
}

async function getTokenData() {
    const tokenData = await getDicts('token_');
    let tokenTable = '', validNum = 0, tokenSelectOption = '';
    for (let tokenInfo of tokenData) {
        try {
            let expireTime, expireDay, color = 'bg-secondary', showText = '无效';
            if (tokenInfo.accessToken) {
                const payload = parseJwt(tokenInfo.accessToken);
                if (payload != null) {
                    let expire = isTokenExpired(tokenInfo.accessToken);
                    if (expire) {
                        showText = '已过期'
                        color = 'bg-danger'
                    } else {
                        validNum++;
                        let exp = payload.exp * 1000;
                        expireDay = betweenDay(exp);
                        color = expireDay > 3 ? 'bg-success' : 'bg-warning';
                        expireTime = formatDate(exp);
                        showText = `${expireTime}(${expireDay}天)`
                    }
                }
            }
            tokenTable += `["${tokenInfo.tokenAccount || ''}", "${tokenInfo.tokenName || ''}", "${tokenInfo.accessToken || ''}", "${tokenInfo.refreshToken || ''}",'<span class="badge ${tokenInfo.plus ? 'bg-success' : 'bg-info'}">${tokenInfo.plus ? '是' : '否'}</span>', '<span class="badge ${color}">${showText}</span>', "<button class='btn btn-sm btn-primary edit-token'>编辑</button> <button class='btn btn-sm btn-danger delete-token'>删除</button>"],`;
            tokenSelectOption += `<option value="${tokenInfo.tokenAccount}">${tokenInfo.tokenName}</option>`;
        } catch (e) {
            //生成html数据错误
        }
    }
    return {
        "tokenTable": tokenTable,
        "validNum": validNum,
        "expireNum": tokenData.length - validNum,
        "tokenSelectOption": tokenSelectOption
    }
}

async function getUserData() {
    const users = await getDicts('user_');
    let userTable = '';
    for (let userInfo of users) {
        try {
            let tokenStr = userInfo.allToken ? '<span class="badge bg-success allToken">全部token</span>' : '';
            if (!userInfo.allToken && userInfo.tokens && userInfo.tokens.length > 0) {
                for (let item of userInfo.tokens) {
                    tokenStr += `<span class="badge bg-primary availableToken">${item.tokenName}</span>`;
                }
            }
            userTable += `["${userInfo.userName}", "${userInfo.userToken}", "${userInfo.shareToken || ''}", "${userInfo.expireIn}",
             '<span class="badge ${userInfo.sessionIsolation ? 'bg-warning' : 'bg-success'}">${userInfo.sessionIsolation ? '是' : '否'}</span>', 
             '<span class="badge ${userInfo.temporarySession ? 'bg-warning' : 'bg-success'}">${userInfo.temporarySession ? '是' : '否'}</span>', 
             "${userInfo.gpt35Limit}", "${userInfo.gpt4Limit}", '${tokenStr}', "<button class='btn btn-sm btn-primary edit-user'>编辑</button> <button class='btn btn-sm btn-danger delete-user'>删除</button>"],`;
        } catch (e) {
            //生成html数据错误
        }
    }
    return {
        "userTable": userTable,
        "userNum": users.length
    }
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
            // 输入不是 JSON 格式t
        }
    }
    return data;
}

const transformArrayToObject = (array, key) => {
    return array.reduce((accumulator, currentObject) => {
        accumulator[currentObject[key]] = currentObject;
        return accumulator;
    }, {});
};

async function getHTML(tokenData, userData) {
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>管理页面</title>
      <!-- Bootstrap CSS -->
      <link href="https://cdn.bootcdn.net/ajax/libs/twitter-bootstrap/5.1.3/css/bootstrap.min.css" rel="stylesheet">
     <link rel="stylesheet" type="text/css" href="https://cdn.bootcss.com/toastr.js/latest/css/toastr.min.css">
     <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/jquery-confirm/3.3.4/jquery-confirm.min.css">
     <link href="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.13/css/select2.min.css" rel="stylesheet">

      <!-- Bootstrap JS -->
      <script src="https://cdn.bootcdn.net/ajax/libs/twitter-bootstrap/5.1.3/js/bootstrap.bundle.min.js"></script>
      <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.16.0/umd/popper.min.js"></script>
      <script src="https://cdn.bootcss.com/toastr.js/latest/js/toastr.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-confirm/3.3.4/jquery-confirm.min.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.13/js/select2.min.js"></script>
      <style>
          .truncate {
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 150px; /* 限制最大宽度 */
              position: relative; /* 确保悬停内容相对于父元素定位 */
          }
          .truncate:hover::after {
              content: attr(title);
              position: absolute;
              background: #fff;
              border: 1px solid #ddd;
              padding: 5px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              white-space: normal;
              z-index: 1000;
              left: 0; /* 调整位置以确保悬停内容在正确位置 */
              top: 100%; /* 显示在元素下方 */
              width: max-content; /* 自动适应内容宽度 */
              max-width: none; /* 取消最大宽度限制 */
          }
          .container {
              max-width: 1200px;
          }
          .modal-content {
              padding: 20px;
          }
          .modal-header {
              background-color: #007bff;
              color: white;
          }
          .modal-header .btn-close {
              color: white;
          }
          .form-group {
              margin-bottom: 15px;
          }
          .form-group label {
              font-weight: bold;
          }
          .form-group input, .form-group select {
              border-radius: 5px;
          }
          .form-group button {
              width: 100%;
          }
          .table th, .table td {
              vertical-align: middle;
              text-align: center; /* 居中对齐 */
          }
          .table thead th {
              background-color: #f8f9fa;
          }
        .tooltip-custom {
            position: absolute;
            background-color: rgba(0, 0, 0, 0.7); /* 半透明黑灰色 */
            color: white; /* 保持文本颜色为白色 */
            padding: 3px 8px; /* 调整大小 */
            font-size: 12px; /* 调整字体大小 */
            border-radius: 4px; /* 保持边框半径 */
            z-index: 1000;
            display: none;
        }
        .tooltip-icon {
            cursor: pointer;
            color: #007bff; /* 蓝色 */
            font-size: 11px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1em;
            height: 1em;
            border-radius: 50%;
            border: 1px solid #007bff; /* 边框颜色 */
            background-color: white; /* 背景颜色 */
        }
      </style>
  </head>
  <body>
  <div class="container mt-5">
      <h1 class="text-center mb-4">管理页面</h1>
      <hr>
      <!-- Dashboard -->
      <div class="row mb-4">
          <div class="col-md-4">
              <div class="card text-center">
                  <div class="card-body">
                      <h5 class="card-title">总用户数</h5>
                      <p class="card-text display-4" id="totalUsers">${userData.userNum}</p>
                  </div>
              </div>
          </div>
          <div class="col-md-4">
              <div class="card text-center">
                  <div class="card-body">
                      <h5 class="card-title">活跃Token数</h5>
                      <p class="card-text display-4" id="activeTokens">${tokenData.validNum}</p>
                  </div>
              </div>
          </div>
          <div class="col-md-4">
              <div class="card text-center">
                  <div class="card-body">
                      <h5 class="card-title">过期Token数</h5>
                      <p class="card-text display-4" id="expiredTokens">${tokenData.expireNum}</p>
                  </div>
              </div>
          </div>
      </div>
      <ul class="nav nav-tabs" id="myTab" role="tablist">
          <li class="nav-item">
              <a class="nav-link active" id="token-tab" data-bs-toggle="tab" href="#token" role="tab" aria-controls="token" aria-selected="true">Token管理</a>
          </li>
          <li class="nav-item">
              <a class="nav-link" id="user-tab" data-bs-toggle="tab" href="#user" role="tab" aria-controls="user" aria-selected="false">用户管理</a>
          </li>
      </ul>
      <div class="tab-content" id="myTabContent">
          <div class="tab-pane fade show active" id="token" role="tabpanel" aria-labelledby="token-tab">
              <div class="d-flex justify-content-between my-3">
                  <input type="text" id="tokenSearch" class="form-control w-25" placeholder="搜索 Token名 或 Plus账号">
                  <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#tokenModal">创建Token</button>
              </div>
              <table class="table table-bordered">
                  <thead>
                      <tr>
                          <th>Token唯一名</th>
                          <th>名称</th>
                          <th >AccessToken</th>
                          <th >RefreshToken</th>
                          <th>plus账号</th>
                          <th>有效期</th>
                          <th>操作</th>
                      </tr>
                  </thead>
                  <tbody id="tokenTableBody">
                      <!-- 动态内容 -->
                  </tbody>
              </table>
          </div>
          <div class="tab-pane fade" id="user" role="tabpanel" aria-labelledby="user-tab">
              <div class="d-flex justify-content-between my-3">
                  <input type="text" id="userSearch" class="form-control w-25" placeholder="搜索 用户名">
                  <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#userModal">创建用户</button>
              </div>
              <table class="table table-bordered">
                  <thead>
                      <tr>
                          <th>用户名</th>
                          <th>用户Token</th>
                          <th>分享Token</th>
                          <th>有效时间(秒) <span class="tooltip-icon" data-toggle="tooltip" title="为0取AccessToken过期时间，负数吊销令牌">!</span></th>
                          <th>会话隔离</th>
                          <th>临时聊天</th>
                          <th>3.5次数<span class="tooltip-icon" data-toggle="tooltip" title="为0无法使用，负数不限制">!</span></th>
                          <th>4.0次数<span class="tooltip-icon" data-toggle="tooltip" title="为0无法使用，负数不限制">!</span></th>
                          <th>可用账号</th>
                          <th>操作</th>
                      </tr>
                  </thead>
                  <tbody id="userTableBody">
                      <!-- 动态内容 -->
                  </tbody>
              </table>
          </div>
      </div>
      
  </div>
  
  <!-- Token Modal -->
  <div class="modal fade" id="tokenModal" tabindex="-1" aria-labelledby="tokenModalLabel" aria-hidden="true" data-backdrop="static">
  <div class="modal-dialog">
      <div class="modal-content">
          <div class="modal-header">
              <h5 class="modal-title" id="tokenModalLabel">创建/编辑 Token</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <form id="tokenForm" action="/token" method="POST">
                <div class="mb-3">
                    <label for="tokenName" class="form-label">Token唯一名</label>
                    <input type="text" class="form-control" id="tokenAccount" name="tokenAccount" required>
                </div>
                <div class="mb-3">
                    <label for="tokenName" class="form-label">显示名</label>
                    <input type="text" class="form-control" id="tokenName" name="tokenName" required>
                </div>
                <div class="mb-3">
                    <label for="token" class="form-label">
                    AccessToken/RefreshToken 
                    <a type="button" class="btn btn-link" href="https://token.oaifree.com/auth" target="_blank">三方获取</a>
                    <a type="button" class="btn btn-link" href="https://chat.openai.com/api/auth/session" target="_blank">官方获取</a>
                    </label>
                    <textarea class="form-control" id="token" rows="3" name="token" required></textarea>
                </div>
                <div class="form-check mb-3">
                    <input class="form-check-input" type="checkbox" value="true" name="plus" id="plus">
                    <label class="form-check-label" for="plus">
                        plus账号
                    </label>
                </div>
                <div class="col-auto align-self-end">
                    <button class="btn btn-primary" style="float: right;" type="submit">提交</button> 
                </div>
            </form>
          </div>
      </div>
  </div>
</div>

  
  <!-- User Modal -->
  <div class="modal fade" id="userModal" tabindex="-1" aria-labelledby="userModalLabel" aria-hidden="true" data-backdrop="static">
      <div class="modal-dialog">
          <div class="modal-content">
              <div class="modal-header">
                  <h5 class="modal-title" id="userModalLabel">创建/编辑 用户</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">
                  <form id="userForm" action="/user">
                      <div class="form-group">
                          <label for="userName">用户名</label>
                          <input type="text" class="form-control" id="userName" name="userName" required>
                      </div>
                      <div class="form-group">
                          <label for="userToken">用户Token</label> 
                          <input type="text" class="form-control" id="userToken" name="userToken" required>
                      </div>
                      <div class="form-group">
                          <label for="validTime">过期秒数(为0取AccessToken过期时间，负数吊销令牌)</label>
                          <input type="number" class="form-control" id="expireIn" name="expireIn" value="0" required>
                      </div>
                      <div class="form-group">
                          <label for="count3_5">3.5次数(为0无法使用，负数不限制)</label>
                          <input type="number" class="form-control" id="gpt35Limit" value="-1" name="gpt35Limit" required>
                      </div>
                      <div class="form-group">
                          <label for="count4_0">4.0次数 (为0无法使用，负数不限制)</label>
                          <input type="number" class="form-control" id="gpt4Limit" value="-1" name="gpt4Limit" required>
                      </div>
                      <div class="form-group">
                        <label for="count4_0">可用token</label>
                        <div class="form-check form-check-inline" style="padding-left: 50px">
                            <input class="form-check-input" type="checkbox" id="allToken" value="true" name="allToken" checked="true" onclick="toggleDropdown()">
                            <label class="form-check-label" for="allToken">全部Token</label>
                        </div>
                    </div>
                    <div class="form-group" id="availableTokenDiv">
                        <select id="availableTokens" name="tokens" class="form-control" multiple="multiple">
                            ${tokenData.tokenSelectOption}
                        </select>
                        <div id="availableTokensShow"></div>
                    </div>
                      <div class="form-group">
                          <div class="form-check form-check-inline">
                              <input class="form-check-input" type="checkbox" id="sessionIsolation" value="true" name="sessionIsolation" checked="true" >
                              <label class="form-check-label" for="sessionIsolation">会话隔离</label>
                          </div>
                          <div class="form-check form-check-inline">
                              <input class="form-check-input" type="checkbox" id="temporarySession" value="true" name="temporarySession" >
                              <label class="form-check-label" for="temporarySession">临时聊天</label>
                          </div>
                      </div>
                      <div class="col-auto align-self-end">
                        <button class="btn btn-primary" style="float: right;" type="submit">提交</button> 
                    </div>
                  </form>
              </div>
          </div>
      </div>
  </div>
  <div id="custom-tooltip" class="tooltip-custom">已复制</div>
  <script>
      $(document).ready(function(){
          let tab =  getUrlParams('tab');
          if(tab){
              activeTab(tab);
          }
          $("#tokenSearch").on("keyup", function() {
              var value = $(this).val().toLowerCase();
              $("#tokenTableBody tr").filter(function() {
                  $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1)
              });
          });
          $("#userSearch").on("keyup", function() {
              var value = $(this).val().toLowerCase();
              $("#userTableBody tr").filter(function() {
                  $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1)
              });
          });
  
          // 示例数据填充
          var tokenData = [
              ${tokenData.tokenTable}
          ];
  
          var userData = [
              ${userData.userTable}
          ];
  
          tokenData.forEach(function(row) {
            var tr = $("<tr></tr>");
            row.forEach(function(cell, index) {
                var td = $("<td></td>");
                if ((index === 2 || index === 3) &&  cell) {
                    td.addClass("truncate").attr("title", cell).text(cell);
                    td.on("click", function() {
                        navigator.clipboard.writeText(cell);
                        showCopyTip();
                    });
                } else {
                    td.html(cell);
                }
                tr.append(td);
            });
            $("#tokenTableBody").append(tr);
        });

        userData.forEach(function(row) {
            var tr = $("<tr></tr>");
            row.forEach(function(cell, index) {
                var td = $("<td></td>");
                if (index === 2 && cell ) {
                    td.addClass("truncate").attr("title", cell).text(cell);
                    td.on("click", function() {
                        navigator.clipboard.writeText(cell);
                        showCopyTip();
                    });
                } else {
                    td.html(cell);
                }
                tr.append(td);
            });
            $("#userTableBody").append(tr);
        });
      });
  
      $("#tokenForm").on("submit", function(event) {
          event.preventDefault();

          var formData = new FormData(event.target);
          var formDataObj = {};

          formData.forEach((value, key) => {
              formDataObj[key] = value;
          });
          $.ajax({
            url: '/token', 
            type: 'POST',
            contentType: 'application/json', // 告诉服务器数据格式是JSON
            data: JSON.stringify(formDataObj), // 将JavaScript对象转换为JSON字符串
            success: function (response) {
                if(response.status == '200'){
                    // 提交表单逻辑
                    $('#tokenModal').modal('hide');
                    toastr.success("保存成功")
                    setTimeout(function(){
                        // 刷新当前页面
                        location.href = gotoUrl("token");
                    },1500)
                }else{
                    toastr.error(response.message);
                }
            },
            error: function (error) {
                toastr.error("保存失败：" + error.message);
            }
          });
      });
  
      $("#userForm").on("submit", function(event) {
          event.preventDefault();
          var formData = new FormData(event.target);
          var formDataObj = {};
          let tokens = [];

          formData.forEach((value, key) => {
             if(key === 'tokens'){
                tokens.push(value);
             }else{
                formDataObj[key] = value;
            }
          });
          formDataObj['tokens'] = tokens;
          $.ajax({
            url: '/user', 
            type: 'POST',
            contentType: 'application/json', // 告诉服务器数据格式是JSON
            data: JSON.stringify(formDataObj), // 将JavaScript对象转换为JSON字符串
            success: function (response) {
                if(response.status == '200'){
                    // 提交表单逻辑
                    $('#userModal').modal('hide');
                    toastr.success("保存成功")
                    setTimeout(function(){
                        // 刷新当前页面
                        location.href = gotoUrl("user");
                    },1500)
                }else{
                    toastr.error(response.message);
                }
            },
            error: function (error) {
                toastr.error("保存失败：" + error.message);
            }
          });    
      });
  
      // 编辑和删除按钮的处理
      $(document).on("click", ".edit-token", function() {
        var row = $(this).closest("tr").children("td").map(function() {
            return $(this).text();
        }).get();

        $("#tokenAccount").val(row[0]);
        $("#tokenName").val(row[1]);
        $('textarea[name="token"]').val(row[3]?row[3]:row[2]);
        $('#plus').prop('checked', row[4] == '是'?true:false);
        
        $("#tokenAccount").prop('readonly', true);
        $('#tokenModal').modal('show');
      });
  
      $(document).on("click", ".delete-token", function() {
        var row = $(this).closest("tr").children("td").map(function() {
            return $(this).text();
        }).get();
        $.confirm({
            title: '删除token!',
            content: '确定删除【'+row[0]+'】吗',
            buttons: {
                confirm: {
                    text: '确认', 
                    action: function () {
                        $.ajax({
                            url: '/token', 
                            type: 'DELETE',
                            contentType: 'application/json', // 告诉服务器数据格式是JSON
                            data: JSON.stringify({"tokenAccount":row[0]}), // 将JavaScript对象转换为JSON字符串
                            success: function (response) {
                                if(response.status == '200'){
                                    // 提交表单逻辑
                                    toastr.success("删除成功")
                                    setTimeout(function(){
                                        // 刷新当前页面
                                        location.href = gotoUrl("token");
                                    },1500)
                                }else{
                                    toastr.error(response.message);
                                }
                            },
                            error: function (error) {
                                toastr.error("保存失败：" + error.message);
                            }
                          });
                    }
                },
                cancel: {
                    text: '取消',
                },
            }
        });
      });
      
      function showCopyTip(){
            // 显示自定义 tooltip
            var tooltip = $('#custom-tooltip');
            tooltip.css({
                top: event.pageY + 10 + 'px',
                left: event.pageX + 10 + 'px',
                display: 'block'
            });

            // 一段时间后隐藏 tooltip
            setTimeout(function () {
                tooltip.fadeOut(300);
            }, 1000);
      }
  
      $(document).on("click", ".edit-user", function() {
            var row = $(this).closest("tr").children("td").map(function() {
                return $(this).text();
            }).get();
           const allToken = $(this).closest("tr").find(".allToken ").text() === '全部token';
           const availableToken = $(this).closest("tr").find(".availableToken").map(function () {
                return $(this).text();
            }).get()
    
            $("#userName").val(row[0]);
            $("#userToken").val(row[1]);
            $("#expireIn").val(row[3]);
            $("#gpt35Limit").val(row[6]);
            $("#gpt4Limit").val(row[7]);
            $('#sessionIsolation').prop('checked', row[4] == '是'?true:false);
            $('#temporarySession').prop('checked', row[5] == '是'?true:false);
            $('#allToken').prop('checked', allToken?true:false);
            let tokens = [];
            if (!allToken) {
                $("#availableTokens option").each(function () {
                    if (availableToken.indexOf($(this).text()) >= 0) {
                        tokens.push($(this).val());
                    }
                });
               if (tokens.length > 0) {
                    // 设置选中的值
                    $('#availableTokens').val(tokens).trigger('change');
               }                
            }
            
            $("#userToken").prop('readonly', true);
            $('#userModal').modal('show');
      });
  
      $(document).on("click", ".delete-user", function() {
        var row = $(this).closest("tr").children("td").map(function() {
            return $(this).text();
        }).get();
        $.confirm({
            title: '删除用户!',
            content: '确定删除【'+row[0]+'】吗',
            buttons: {
                confirm: {
                    text: '确认', 
                    action: function () {
                        $.ajax({
                            url: '/user', 
                            type: 'DELETE',
                            contentType: 'application/json', // 告诉服务器数据格式是JSON
                            data: JSON.stringify({"userToken":row[1]}), // 将JavaScript对象转换为JSON字符串
                            success: function (response) {
                                if(response.status == '200'){
                                    // 提交表单逻辑
                                    toastr.success("删除成功")
                                    setTimeout(function(){
                                        // 刷新当前页面
                                        location.href = gotoUrl("user");
                                    },1500)
                                }else{
                                    toastr.error(response.message);
                                }
                            },
                            error: function (error) {
                                toastr.error("保存失败：" + error.message);
                            }
                          });
                    }
                },
                cancel: {
                    text: '取消',
                },
            }
        });
      });
      // 在模态框隐藏时重置表单
      $('#tokenModal').on('hidden.bs.modal', function () {
          $("#tokenAccount").prop('readonly', false);
          $('#tokenForm')[0].reset();   
          $("#userToken").prop('readonly', false);
          $('#userForm')[0].reset();
      });      
      $('#userModal').on('shown.bs.modal', function () {
        $('#availableTokens').select2({
            dropdownParent: $('#availableTokensShow'),
            placeholder: '选择token',
            allowClear: true
        });
        toggleDropdown();
     });
     function toggleDropdown() {
        var checkbox = document.getElementById('allToken');
        var dropdown = document.getElementById('availableTokenDiv');

        if (checkbox.checked) {
            dropdown.style.display = 'none';
        } else {
            dropdown.style.display = 'block';
        }
    }
    function activeTab(tab) {
        // 移除所有选项卡的 active 类
        $('.nav-link').removeClass('active');
        $('.tab-pane').removeClass('active show');

        // 为 Profile 选项卡添加 active 类
        $("#"+tab+"-tab").addClass('active');
        $("#"+tab).addClass('active show');
    }
    function gotoUrl(tab) {
      // 获取当前 URL
      const url = window.location.href;
      // 创建 URL 对象
      const urlObj = new URL(url);
      return  urlObj.protocol +'//' +  urlObj.host +urlObj.pathname +"?tab="+tab;
    }
    // 获取 URL 参数的函数
    function getUrlParams(key) {
        // 获取当前 URL 的查询字符串部分（包括 ?）
        const queryString = window.location.search;
        // 创建 URLSearchParams 对象
        const params = new URLSearchParams(queryString);

        // 创建一个对象来存储参数
        const paramsObj = {};
        // 遍历所有参数并添加到对象中
        params.forEach((value, key) => {
            paramsObj[key] = value;
        });
        return paramsObj[key];
    }
  </script>
  </body>
  </html>
  `;
}