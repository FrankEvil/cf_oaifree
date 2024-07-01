本贴子参考各位佬友的work喂饭代码，感谢各位佬友的分享
```
https://linux.do/t/topic/93659/1
https://linux.do/t/topic/103797
```
当然最需要感谢始皇的镜像站和服务，这是作为一切的基础。

https://linux.do/t/topic/47799

自己有几个chatgpt的普号，由于始皇的 [镜像站](https://new.oaifree.com/) 支持普号并且可以使用 4o模型，于是想着使用佬友的喂饭代码，想实现4o自由。由于只是自用,搭建后有些不符合自己心意于是在原有基础上做了些改动，也借此分享给各位佬友。

优化改动

1. 使用http base auth 验证后台页面
2. 使用表格管理gpt账号和用户
3. 优化使用界面稍微美化下(chatgpt写的 我不会)

效果结果：
![image|690x302, 50%](upload://i4UkJYkvpz2pNXn7mZibRHSze3r.png) ![image|690x292, 50%](upload://ey9vKrnwyn7l0PjMZRt7AcqXqjL.png)![image|533x500, 50%](upload://ynLx3DlZAP2jjJvGyx8987BwMe6.png)![image|690x347, 50%](upload://hlHPsGyKBHmKHg8qccQq6SjHImJ.png)
![image|500x500, 50%](upload://9Odpi0O39Fm6CPZ3LvUSNOcBMEc.png)![image|690x393, 50%](upload://zvNeobxmvr40VyM08TYQAtwtyfD.png)
![image|689x292](upload://8qizVQG2r2Iy5I6uM6zumPf859b.png)


部署教程
### 添加workers

需要创建3个workers 具体代码请查看附件[workers.zip|attachment](upload://qJmxHII7s4gOLYt2uyqghXlwJFm.zip) (14.1 KB)
```
后台管理页面 :https://admin.xxxx.workers.dev
反代始皇的new:https://new.xxxx.workers.dev
登录使用页面:https://login.xxxx.workers.dev
```
将跳转的地址改自己的域名 搜索文件中 `workers.dev`

### 创建turnstile验证码
如果不想使用 去掉`login.js`中的
```
//第 130到133行
if (turnstileResponse !== 'do not need Turnstle' && (!turnstileResponse || !await verifyTurnstile(turnstileResponse))) {
    return new Response('Turnstile verification failed', {status: 403});
}
// 第442行
 <div class="cf-turnstile" data-sitekey="自己的cf-turnstile密钥" data-callback="onTurnstileCallback"></div> 
//第466行到469行
if (!document.getElementById('cf-turnstile-response').value) {
    event.preventDefault();
     alert('Please complete the verification.');
}
````
使用在CF中创建
![image|690x440](upload://rxJcIsiAF3YBfUXjaKYoH9nsN5T.png)

域名需要有 `login` workers的域名 站点密钥填入`login`的第442行 密钥记加下来需要配置到下面的 KV中

### 创建 workers & KV
创建kV 
![image|690x288](upload://4kGXj5lYyZSCU6Lsw1kLttqQyDM.png)

名称必须是 `oai_global_variables` 然后命名空间中增加 4个值
```
adminUserName       //管理页面的登录用户名
adminPwd           //管理页面的登录密码
token_prefix       //创建分享的token的前缀可以为空
turnstilekeys      //上一步创建的turnstile的密钥 如过不使用turnstile则不需要
```
![image|690x97](upload://jCja12znE5vgrvuktNxpN3LbQvu.png)
![image|690x69](upload://7GWkzMB8scmmahMdtmXHLEGc4t8.png)

在  `login`   `admin`   workers中绑定命令空间
![image|690x295](upload://x7UMuKxNRr8dtaOitPVFUW4os5n.png)
注意  命令空选择刚刚创建的  名称也必须一样是  `oai_global_variables`

**部署完成！！！**
访问 `https://admin.xxxx.workers.dev` 输入配置的用户名密码  添加管理gpt账号,以及用户
`https://login.xxxx.workers.dev` 选择账户输入配置用户token即可访问 

注意 `token唯一名` 和 `用户token` 只能有一个 相同会修改以前的数据


-----------------------------------------
07-01  修复样式问题
