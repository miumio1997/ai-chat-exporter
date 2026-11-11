# AI 对话导出 · 1.6.27

[安装包](AI对话导出插件_v1.6.27.zip) · [正式安装页](https://chat.baochaolab.com/) · [完整源码与发布链](AI对话导出插件_v1.6.27_源码与发布链.zip)

## 使用与权限

从Chrome/Edge原插件弹窗导出ChatGPT、Claude、Gemini、DeepSeek、豆包、Kimi和通义千问对话，支持TXT、Markdown、HTML、Word、PDF以及当前对话、批量、纯AI、纯用户模式。

解压安装包，在Chrome扩展管理页加载包含manifest.json的文件夹。安装后保留目录位置；更新后重新加载扩展并刷新对话页。仅在主动点击插件时临时访问当前标签页，唯一持续主机权限为更新站点。没有全网站持续访问权限或网页悬浮入口。

HTML保持段落、去掉Gemini来源标签，并保留正文、附件名称、图片引用及跟进文字。PDF/Word排版保持。平台未提供完整历史时保留范围说明；图片是远程引用，附件正文不额外提取。详细隐私范围见[PRIVACY.md](PRIVACY.md)，许可见[MIT LICENSE](LICENSE)。第三方Marked/Markdown声明保留在vendor/marked.LICENSE.md。

源码和安装包不含聊天样例、私人日志、电脑路径或账号凭据。安装包校验见SHA256SUMS.txt。此仓库从已检查的最终版本开始记录，不包含之前的开发提交。
