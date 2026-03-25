### 部署步骤
```sh
# 1. 测试配置文件语法
sudo nginx -t -c /home/acproject/workspace/node_projects/llama.cpp_dashboard/nginx/nginx.conf

# 2. 复制到 Nginx 配置目录
sudo cp /home/acproject/workspace/node_projects/llama.cpp_dashboard/nginx/nginx.conf /etc/nginx/sites-available/llama-orchestrator

# 3. 创建软链接启用配置
sudo ln -s /etc/nginx/sites-available/llama-orchestrator /etc/nginx/sites-enabled/

# 4. 测试并重载
sudo nginx -t && sudo systemctl reload nginx
```