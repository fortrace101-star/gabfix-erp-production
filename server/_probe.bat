@echo off
setlocal enabledelayedexpansion

echo === 1. owner login, capture access token ===
"C:\Windows\System32\curl.exe" --max-time 10 -s -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -H "X-App-Id: admin" -d @C:\Users\manue\Desktop\gabfix\FinanceMgt\Gabfix-ERP\server\_creds.json  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);require('fs').writeFileSync('C:\\Users\manue\\Desktop\gabfix\FinanceMgt\Gabfix-ERP\\server\\_token.txt',j.accessToken);console.log('login OK role='+j.user.role)})"
set TOKEN=
set /P TOKEN=<C:\Users\manue\Desktop\gabfix\FinanceMgt\Gabfix-ERP\server\_token.txt
echo token-len=%TOKEN:~0,10%...%TOKEN:~-5%

echo === 2. fire a PATCH /api/jobs/:id to trigger job-updated ===
"C:\Windows\System32\curl.exe" --max-time 10 -s -w "\nJAN HTTP=%{http_code}\n" -X PATCH http://localhost:5000/api/jobs/01928374-6543-2109-8765-43210fedcba0 -H "Authorization: Bearer %TOKEN%" -H "X-App-Id: portal" -H "Content-Type: application/json" --data "{\"status\":\"In Progress\",\"notes\":\"live-update check\"}"
echo.

echo === 3. check server stderr for the publish line ===
findstr /i "job-updated\|SSE\|subscribe" "C:\Users\manue\Desktop\gabfix\FinanceMgt\Gabfix-ERP\server\server.log" 2>nul | more +0